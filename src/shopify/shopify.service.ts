import {
  Injectable,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, LessThan, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ShopifyConnection } from '../entities/shopify-connection.entity';
import { Contact } from '../entities/contact.entity';
import { Sale } from '../entities/sale.entity';
import { Product } from '../entities/product.entity';
import { User } from '../entities/user.entity';
import { Plan } from '../entities/plan.entity';
import { Subscription } from '../entities/subscription.entity';
import { ShopifyWebhookEvent } from '../entities/shopify-webhook-event.entity';
import { ShopifyDataRequest } from '../entities/shopify-data-request.entity';
import { WebhookLog } from '../entities/webhook-log.entity';
import { ContactPurchase } from '../entities/contact-purchase.entity';
import { CampaignMessageEvent } from '../entities/campaign-message-event.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../entities/notification.entity';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';
import { lookup } from 'dns/promises';
import { isIP } from 'net';

@Injectable()
export class ShopifyService {
  private readonly clientId: string;
  private readonly clientSecret: string;
  // Versão da Admin API. Configurável por env para facilitar o bump trimestral.
  private readonly apiVersion: string;
  private readonly scopes: string = 'write_products,read_orders,read_customers,read_checkouts,write_discounts,read_discounts,write_gift_cards,read_gift_cards';
  private readonly logger = new Logger(ShopifyService.name);

  /** Extrai o ID numérico de um GID do GraphQL (ex.: gid://shopify/Product/123 → "123"). */
  private gidToId(gid: string): string {
    if (!gid) return gid;
    return gid.split('/').pop() || gid;
  }

  /**
   * A partir de 2026-01, `Customer.email/phone/emailMarketingConsent/
   * smsMarketingConsent` estão depreciados em favor de `defaultEmailAddress` e
   * `defaultPhoneNumber`. Os campos antigos ainda respondem em 2026-07, mas
   * usamos os novos quando disponíveis — e mantemos os antigos para quem fixar
   * uma versão anterior via SHOPIFY_API_VERSION (onde os novos não existem).
   */
  private get usesCustomerContactObjects(): boolean {
    // Formato YYYY-MM: comparação lexicográfica funciona.
    return this.apiVersion >= '2026-01';
  }

  /** Fragmento GraphQL dos dados de contato/consentimento do cliente. */
  private customerContactFields(): string {
    return this.usesCustomerContactObjects
      ? `
        defaultEmailAddress { emailAddress marketingState }
        defaultPhoneNumber { phoneNumber marketingState }
      `
      : `
        email
        phone
        emailMarketingConsent { marketingState }
        smsMarketingConsent { marketingState }
      `;
  }

  /** Normaliza o cliente dos dois shapes (antigo e novo) para um só. */
  private mapCustomerContact(c: any): {
    email: string | null;
    phone: string | null;
    emailMarketingState: string | null;
    smsMarketingState: string | null;
  } {
    return {
      email: c?.defaultEmailAddress?.emailAddress ?? c?.email ?? null,
      phone: c?.defaultPhoneNumber?.phoneNumber ?? c?.phone ?? null,
      emailMarketingState:
        c?.defaultEmailAddress?.marketingState ?? c?.emailMarketingConsent?.marketingState ?? null,
      smsMarketingState:
        c?.defaultPhoneNumber?.marketingState ?? c?.smsMarketingConsent?.marketingState ?? null,
    };
  }

  constructor(
    @InjectRepository(ShopifyConnection)
    private shopifyConnectionRepository: Repository<ShopifyConnection>,
    @InjectRepository(Contact)
    private contactRepository: Repository<Contact>,
    @InjectRepository(Sale)
    private saleRepository: Repository<Sale>,
    @InjectRepository(Product)
    private productRepository: Repository<Product>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(Plan)
    private planRepository: Repository<Plan>,
    @InjectRepository(Subscription)
    private subscriptionRepository: Repository<Subscription>,
    @InjectRepository(ShopifyWebhookEvent)
    private webhookEventRepository: Repository<ShopifyWebhookEvent>,
    @InjectRepository(ShopifyDataRequest)
    private dataRequestRepository: Repository<ShopifyDataRequest>,
    @InjectRepository(WebhookLog)
    private webhookLogRepository: Repository<WebhookLog>,
    @InjectRepository(ContactPurchase)
    private contactPurchaseRepository: Repository<ContactPurchase>,
    @InjectRepository(CampaignMessageEvent)
    private campaignMessageEventRepository: Repository<CampaignMessageEvent>,
    private notificationsService: NotificationsService,
    private configService: ConfigService,
  ) {
    this.clientId = this.configService.get<string>('SHOPIFY_CLIENT_ID') || '';
    this.clientSecret =
      this.configService.get<string>('SHOPIFY_CLIENT_SECRET') || '';
    // 2026-07 é a versão estável atual. A anterior (2025-10) expira em out/2026;
    // rollback imediato é possível via env, e as queries se adaptam aos campos
    // de cliente da versão escolhida (ver `usesCustomerContactObjects`).
    this.apiVersion =
      this.configService.get<string>('SHOPIFY_API_VERSION') || '2026-07';
  }

  /**
   * Gera a URL de autorização OAuth
   */
  generateAuthUrl(shop: string, redirectUri: string, state: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      scope: this.scopes,
      redirect_uri: redirectUri,
      state: state,
    });

    return `https://${shop}/admin/oauth/authorize?${params.toString()}`;
  }

  /**
   * Valida se o domínio informado é uma loja Shopify legítima (*.myshopify.com).
   * Bloqueia injeção de host arbitrário no fluxo OAuth.
   */
  validateShopDomain(shop: string): boolean {
    return /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(shop || '');
  }

  /**
   * Aceita tanto o domínio permanente quanto a URL pública da vitrine. Para
   * domínios próprios, lê apenas a página inicial e extrai o domínio
   * `*.myshopify.com` publicado pela própria Shopify no HTML.
   */
  async resolveShopDomain(input: string): Promise<string> {
    const raw = String(input || '').trim();
    if (!raw) throw new BadRequestException('Informe o domínio da loja Shopify');

    let parsed: URL;
    try {
      parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    } catch {
      throw new BadRequestException('Domínio de loja inválido');
    }

    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
    if (
      parsed.username || parsed.password ||
      (parsed.port && parsed.port !== '443') ||
      !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(hostname)
    ) {
      throw new BadRequestException('Domínio de loja inválido');
    }

    if (this.validateShopDomain(hostname)) return hostname;

    // Evita que o resolvedor de vitrines seja usado para acessar rede interna.
    let addresses: Array<{ address: string; family: number }>;
    try {
      addresses = await lookup(hostname, { all: true, verbatim: true });
    } catch {
      throw new BadRequestException('Não foi possível localizar o domínio informado');
    }
    if (!addresses.length || addresses.some(({ address }) => !this.isPublicAddress(address))) {
      throw new BadRequestException('Domínio de loja inválido');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(`https://${hostname}/`, {
        method: 'GET',
        redirect: 'error',
        signal: controller.signal,
        headers: { 'User-Agent': 'NucleoCRM-Shopify-Domain-Resolver/1.0' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const html = (await response.text()).slice(0, 2_000_000);
      const match = html.match(/(?:Shopify\.shop\s*=\s*["']|"myshopifyDomain"\s*:\s*["'])([a-z0-9][a-z0-9-]*\.myshopify\.com)/i);
      const permanentDomain = match?.[1]?.toLowerCase();
      if (!permanentDomain || !this.validateShopDomain(permanentDomain)) {
        throw new Error('Identificador Shopify ausente');
      }
      return permanentDomain;
    } catch (error) {
      this.logger.warn(`[Shopify Domain] Não foi possível resolver ${hostname}: ${error.message}`);
      throw new BadRequestException(
        'Não foi possível identificar essa loja Shopify. Informe o domínio terminado em .myshopify.com.',
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private isPublicAddress(address: string): boolean {
    const family = isIP(address);
    if (family === 4) {
      const [a, b] = address.split('.').map(Number);
      return !(
        a === 0 || a === 10 || a === 127 ||
        (a === 100 && b >= 64 && b <= 127) ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        a >= 224
      );
    }
    if (family === 6) {
      const normalized = address.toLowerCase();
      return !(
        normalized === '::' || normalized === '::1' ||
        normalized.startsWith('fc') || normalized.startsWith('fd') ||
        normalized.startsWith('fe8') || normalized.startsWith('fe9') ||
        normalized.startsWith('fea') || normalized.startsWith('feb') ||
        normalized.startsWith('::ffff:127.') || normalized.startsWith('::ffff:10.') ||
        normalized.startsWith('::ffff:192.168.')
      );
    }
    return false;
  }

  /**
   * Verifica o parâmetro `hmac` de uma request OAuth vinda da Shopify.
   * Algoritmo oficial: remover hmac/signature, ordenar os demais params,
   * montar `key=value&...` e comparar HMAC-SHA256 (hex) com o client secret.
   */
  verifyOAuthHmac(query: Record<string, any>): boolean {
    if (!this.clientSecret) return false;
    const { hmac, signature, ...rest } = query || {};
    if (!hmac || typeof hmac !== 'string') return false;

    const message = Object.keys(rest)
      .sort()
      .map((key) => {
        const value = rest[key];
        return `${key}=${Array.isArray(value) ? value.join(',') : value}`;
      })
      .join('&');

    const digest = crypto
      .createHmac('sha256', this.clientSecret)
      .update(message)
      .digest('hex');

    try {
      return crypto.timingSafeEqual(
        Buffer.from(digest, 'hex'),
        Buffer.from(hmac, 'hex'),
      );
    } catch {
      return false;
    }
  }

  /**
   * Gera um `state` (nonce anti-CSRF) assinado e sem estado (stateless).
   * Payload contém a loja + nonce + timestamp, assinado com o client secret.
   */
  generateSignedState(shop: string): string {
    const payload = Buffer.from(
      JSON.stringify({
        shop,
        nonce: crypto.randomBytes(16).toString('hex'),
        ts: Date.now(),
      }),
    ).toString('base64url');
    const sig = crypto
      .createHmac('sha256', this.clientSecret)
      .update(payload)
      .digest('hex');
    return `${payload}.${sig}`;
  }

  /**
   * Verifica um `state` assinado: valida assinatura, vínculo com a loja
   * e janela de validade (padrão 10 minutos).
   */
  verifySignedState(
    state: string,
    shop: string,
    maxAgeMs = 10 * 60 * 1000,
  ): boolean {
    if (!state || !this.clientSecret) return false;
    const [payload, sig] = state.split('.');
    if (!payload || !sig) return false;

    const expected = crypto
      .createHmac('sha256', this.clientSecret)
      .update(payload)
      .digest('hex');

    try {
      if (
        !crypto.timingSafeEqual(
          Buffer.from(sig, 'hex'),
          Buffer.from(expected, 'hex'),
        )
      ) {
        return false;
      }
    } catch {
      return false;
    }

    try {
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
      if (data.shop !== shop) return false;
      if (Date.now() - data.ts > maxAgeMs) return false;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Verifica um session token (idToken do App Bridge) emitido pela Shopify.
   * É um JWT HS256 assinado com o client secret do app.
   * Valida assinatura, audience (=client_id), validade (exp/nbf) e extrai a loja de `dest`.
   */
  verifySessionToken(token: string): { shop: string; sub?: string; payload: any } {
    if (!token || !this.clientSecret) {
      throw new UnauthorizedException('Session token ausente');
    }
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new UnauthorizedException('Session token malformado');
    }
    const [headerB64, payloadB64, sigB64] = parts;

    const expected = crypto
      .createHmac('sha256', this.clientSecret)
      .update(`${headerB64}.${payloadB64}`)
      .digest('base64url');

    let signatureOk = false;
    try {
      signatureOk = crypto.timingSafeEqual(
        Buffer.from(sigB64),
        Buffer.from(expected),
      );
    } catch {
      signatureOk = false;
    }
    if (!signatureOk) {
      throw new UnauthorizedException('Assinatura do session token inválida');
    }

    let payload: any;
    try {
      payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    } catch {
      throw new UnauthorizedException('Payload do session token inválido');
    }

    const now = Math.floor(Date.now() / 1000);
    const leeway = 10; // segundos de tolerância de relógio
    if (payload.exp && now > payload.exp + leeway) {
      throw new UnauthorizedException('Session token expirado');
    }
    if (payload.nbf && now + leeway < payload.nbf) {
      throw new UnauthorizedException('Session token ainda não é válido');
    }
    if (payload.aud !== this.clientId) {
      throw new UnauthorizedException('Audience do session token inválido');
    }

    let shop = '';
    try {
      shop = new URL(payload.dest).host;
    } catch {
      throw new UnauthorizedException('Campo dest do session token inválido');
    }
    if (!this.validateShopDomain(shop)) {
      throw new UnauthorizedException('Loja do session token inválida');
    }

    return { shop, sub: payload.sub, payload };
  }

  /**
   * Autentica uma request embedded via session token da Shopify.
   * Verifica o token, resolve a loja e retorna o usuário CRM da conexão ativa.
   * Lança NotFound (NEEDS_INSTALL) se a loja não estiver conectada no nosso lado.
   */
  async authenticateSessionToken(token: string): Promise<{ shop: string; user: User }> {
    const { shop } = this.verifySessionToken(token);
    const connection = await this.findActiveConnectionByShop(shop);
    if (!connection) {
      throw new NotFoundException(`Loja ${shop} não conectada. Instale o app.`);
    }
    const user = await this.userRepository.findOne({ where: { id: connection.userId } });
    if (!user) {
      throw new NotFoundException('Usuário da loja não encontrado');
    }
    return { shop, user };
  }

  /**
   * Troca o código de autorização por um token de acesso
   */
  async exchangeCodeForToken(
    shop: string,
    code: string,
  ): Promise<{ 
    access_token: string; 
    scope: string;
    refresh_token?: string;
    expires_in?: number;
  }> {
    this.logger.log(`[Shopify OAuth] Trocando código por token para a loja: ${shop}`);
    const params = new URLSearchParams();
    params.append('client_id', this.clientId);
    params.append('client_secret', this.clientSecret);
    params.append('code', code);
    params.append('expiring', '1');

    const url = `https://${shop}/admin/oauth/access_token`;
    this.logger.log(`[Shopify OAuth] POST ${url}`);

    const response = await fetch(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        body: params.toString(),
      },
    );

    const responseText = await response.text();
    this.logger.log(`[Shopify OAuth] Status: ${response.status} ${response.statusText}`);
    // NÃO logar o corpo da resposta: contém access_token em texto claro.

    if (!response.ok) {
      const error = JSON.parse(responseText || '{}');
      this.logger.error(`[Shopify OAuth] Erro na troca de token para ${shop}: ${response.status} - ${JSON.stringify(error)}`);
      throw new BadRequestException(
        error.error_description || 'Falha ao obter token de acesso',
      );
    }

    const data = JSON.parse(responseText);
    
    this.logger.log(`[Shopify OAuth] Token obtido com sucesso para ${shop}. Expiring: ${!!data.expires_in}`);
    if (!data.expires_in) {
      this.logger.warn(`[Shopify OAuth] ALERTA: Recebido token permanente (non-expiring). Isso falhará na API 2024-07. Verifique o Partner Dashboard.`);
    }

    return data;
  }

  /**
   * Criptografa o token de acesso antes de salvar
   */
  private encryptToken(token: string): string {
    const algorithm = 'aes-256-cbc';
    const key = crypto
      .createHash('sha256')
      .update(this.clientSecret || 'default-secret')
      .digest();
    const iv = crypto.randomBytes(16);

    const cipher = crypto.createCipheriv(algorithm, key, iv);
    let encrypted = cipher.update(token, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    return iv.toString('hex') + ':' + encrypted;
  }

  /**
   * Descriptografa o token de acesso
   */
  private decryptToken(encryptedToken: string): string {
    const algorithm = 'aes-256-cbc';
    const key = crypto
      .createHash('sha256')
      .update(this.clientSecret || 'default-secret')
      .digest();

    const parts = encryptedToken.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];

    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  /**
   * Token exchange da Shopify (managed installation): troca um session token do
   * App Bridge por um access token OFFLINE da Admin API, sem passar pelo fluxo
   * OAuth de redirect. É o caminho recomendado para apps embedded.
   * https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/token-exchange
   */
  async exchangeSessionTokenForAccessToken(
    shop: string,
    sessionToken: string,
  ): Promise<{ access_token: string; scope: string; refresh_token?: string; expires_in?: number }> {
    this.logger.log(`[Shopify Token Exchange] Trocando session token por access token para ${shop}`);

    const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token: sessionToken,
        subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
        requested_token_type: 'urn:shopify:params:oauth:token-type:offline-access-token',
        // Apps públicos criados a partir de 2026-04 devem usar tokens offline
        // expiring. Sem este campo a Shopify ainda emite o token legado, mas a
        // Admin API o recusa imediatamente com HTTP 403.
        expiring: 1,
      }),
    });

    const responseText = await response.text();
    // NÃO logar o corpo: contém access_token em texto claro.

    if (!response.ok) {
      let error: any = {};
      try { error = JSON.parse(responseText || '{}'); } catch { /* corpo não-JSON */ }
      this.logger.error(`[Shopify Token Exchange] Falha para ${shop}: ${response.status} - ${error.error || ''} ${error.error_description || ''}`);
      throw new UnauthorizedException(
        error.error_description || 'Falha no token exchange com a Shopify',
      );
    }

    return JSON.parse(responseText);
  }

  /**
   * Primeiro acesso embedded (managed install): a loja ainda não tem conexão no
   * nosso lado. Usa o próprio session token para obter um access token offline
   * via token exchange, resolve/cria o usuário CRM pelo e-mail da loja e salva a
   * conexão. Substitui o redirect para o fluxo OAuth legado.
   */
  async provisionConnectionFromSessionToken(
    sessionToken: string,
  ): Promise<{ shop: string; user: User }> {
    const { shop } = this.verifySessionToken(sessionToken);

    const tokenData = await this.exchangeSessionTokenForAccessToken(shop, sessionToken);

    const shopInfo = await this.getShopInfo(shop, tokenData.access_token);
    const user = await this.findOrCreateUserFromShopify(shopInfo, shop);

    // Isolamento de conta: conta Asaas ou já ligada a outra loja não pode
    // conectar esta loja (ConflictException 409 com mensagem própria).
    await this.assertCanConnectShopify(user.id, shop);

    await this.createOrUpdateConnection(
      user.id,
      shop,
      tokenData.access_token,
      tokenData.scope,
      tokenData.refresh_token,
      tokenData.expires_in,
    );

    this.logger.log(`[Shopify Token Exchange] Conexão provisionada para ${shop} (userId ${user.id})`);
    return { shop, user };
  }

  /**
   * Cria ou atualiza uma conexão Shopify
   */
  async createOrUpdateConnection(
    userId: number,
    shop: string,
    accessToken: string,
    scope: string,
    refreshToken?: string,
    expiresIn?: number,
  ): Promise<ShopifyConnection> {
    const encryptedToken = this.encryptToken(accessToken);
    const encryptedRefreshToken = refreshToken ? this.encryptToken(refreshToken) : null;
    const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : null;

    let connection = await this.shopifyConnectionRepository.findOne({
      where: { userId, shop },
    });

    if (connection) {
      connection.accessToken = encryptedToken;
      if (encryptedRefreshToken) connection.refreshToken = encryptedRefreshToken;
      if (expiresAt) connection.expiresAt = expiresAt;
      connection.scope = scope;
      connection.isActive = true;
      connection.lastSyncAt = new Date();
    } else {
      connection = new ShopifyConnection();
      connection.userId = userId;
      connection.shop = shop;
      connection.accessToken = encryptedToken;
      connection.refreshToken = encryptedRefreshToken;
      connection.expiresAt = expiresAt;
      connection.scope = scope;
      connection.isActive = true;
      connection.lastSyncAt = new Date();
    }

    this.logger.log(`[Shopify DB] Salvando conexão para userId: ${userId}, shop: ${shop}`);
    try {
      const result = await this.shopifyConnectionRepository.save(connection);
      this.logger.log(`[Shopify DB] Conexão salva com sucesso. ID: ${result.id}`);
      return result;
    } catch (error) {
      this.logger.error(`[Shopify DB] Erro ao salvar conexão: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Garante que a conta pode conectar esta loja Shopify.
   *
   * Regra de isolamento: uma conta é Asaas OU Shopify (de uma única loja).
   * Bloqueia se a conta já usa Asaas ou já está ligada a outra loja Shopify —
   * nesse caso o usuário precisa de outra conta. Reconectar a MESMA loja é permitido.
   */
  async assertCanConnectShopify(userId: number, shop: string): Promise<void> {
    // 1. Conta já vinculada ao Asaas (customer criado ou assinatura Asaas existente)?
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (user?.asaasCustomerId) {
      throw new ConflictException(
        'Esta conta já usa cobrança Asaas. Crie uma nova conta para conectar uma loja Shopify.',
      );
    }

    const asaasSub = await this.subscriptionRepository
      .createQueryBuilder('s')
      .where('s.userId = :userId', { userId })
      .andWhere('s.asaasSubscriptionId IS NOT NULL')
      .andWhere("s.asaasSubscriptionId <> ''")
      .getOne();
    if (asaasSub) {
      throw new ConflictException(
        'Esta conta já possui assinatura Asaas. Crie uma nova conta para conectar uma loja Shopify.',
      );
    }

    // 2. Conta já conectada a OUTRA loja Shopify?
    const activeConnections = await this.shopifyConnectionRepository.find({
      where: { userId, isActive: true },
    });
    const otherShop = activeConnections.find((c) => c.shop !== shop);
    if (otherShop) {
      throw new ConflictException(
        'Esta conta já está conectada a outra loja Shopify. Use outra conta para conectar esta loja.',
      );
    }
  }

  /**
   * Busca uma conexão ativa do usuário
   */
  async getActiveConnection(
    userId: number,
    shop?: string,
  ): Promise<ShopifyConnection> {
    const where: any = { userId, isActive: true };
    if (shop) {
      where.shop = shop;
    }

    const connection = await this.shopifyConnectionRepository.findOne({
      where,
    });

    if (!connection) {
      throw new NotFoundException('Conexão Shopify não encontrada');
    }

    return connection;
  }

  /**
   * Busca uma conexão ativa por domínio da loja (sem depender de userId)
   */
  async findActiveConnectionByShop(shop: string): Promise<ShopifyConnection | null> {
    return await this.shopifyConnectionRepository.findOne({
      where: { shop, isActive: true },
    });
  }

  /**
   * Busca informações da loja via API da Shopify
   */
  async getShopInfo(shop: string, accessToken: string): Promise<any> {
    const query = `{ shop { name email } }`;
    const result = await this.makeGraphqlRequest(shop, accessToken, query);
    const shopData = result.data?.shop;
    if (!shopData) {
      this.logger.error(`[Shopify ShopInfo] Resposta sem shop para ${shop}: ${JSON.stringify(result.errors || result)}`);
      throw new BadRequestException('Falha ao buscar informações da loja');
    }
    // Mantém o shape usado pelo restante do código (compatível com a REST /shop.json).
    return {
      email: shopData.email,
      name: shopData.name,
      shop_owner: shopData.name,
    };
  }

  /**
   * Busca ou cria um usuário CRM baseado nos dados da Shopify
   */
  async findOrCreateUserFromShopify(shopInfo: any, shop?: string): Promise<User> {
    const merchantEmail = shopInfo.email.toLowerCase().trim();
    let accountEmail = merchantEmail;
    this.logger.log(`[Shopify Auth] Buscando ou criando usuário para e-mail: ${merchantEmail}`);

    let user = await this.userRepository.findOne({ where: { email: merchantEmail } });

    // A mesma pessoa pode já usar o CRM standalone com cobrança Asaas. Uma
    // instalação vinda da App Store precisa usar Shopify Billing e, portanto,
    // não pode herdar aquela conta. Criamos um perfil isolado e determinístico
    // para a loja; o alias continua entregando no e-mail original nos provedores
    // que suportam endereçamento com "+" (como Gmail/Google Workspace).
    if (user && shop) {
      try {
        await this.assertCanConnectShopify(user.id, shop);
      } catch (error) {
        if (!(error instanceof ConflictException)) throw error;

        const [localPart, domain] = merchantEmail.split('@');
        const shopKey = crypto.createHash('sha256').update(shop).digest('hex').slice(0, 12);
        accountEmail = `${localPart.slice(0, 180)}+shopify-${shopKey}@${domain}`;
        this.logger.log(
          `[Shopify Auth] Conta principal incompatível com Shopify Billing; usando perfil isolado para ${shop}`,
        );
        user = await this.userRepository.findOne({ where: { email: accountEmail } });
      }
    }

    if (!user) {
      this.logger.log(`[Shopify Auth] Criando novo usuário para a loja Shopify`);

      // Gerar senha aleatória (usuário poderá resetar depois ou entrar via Shopify)
      const randomPassword = crypto.randomBytes(16).toString('hex');
      const hashedPassword = await bcrypt.hash(randomPassword, 10);

      // Gerar referral code e template ID (copiado da logic do AuthService)
      const referralCode = crypto.randomBytes(4).toString('hex').toUpperCase();
      const templateId = crypto.randomBytes(2).toString('hex').toUpperCase();

      user = this.userRepository.create({
        email: accountEmail,
        password: hashedPassword,
        firstName: shopInfo.name || shopInfo.shop_owner || 'Shopify',
        lastName: 'Merchant',
        active: true, // Auto-ativação via Shopify
        referralCode,
        templateId,
        role: 'user',
      });

      user = await this.userRepository.save(user);
    }

    return user;
  }


  /**
   * Obtém o token de acesso descriptografado, renovando-o se necessário
   */
  async getAccessToken(userId: number, shop?: string): Promise<string> {
    const connection = await this.getActiveConnection(userId, shop);
    
    // Verificar se o token está próximo da expiração (ex: falta menos de 5 minutos)
    if (connection.expiresAt && connection.refreshToken) {
      const now = new Date();
      const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);
      
      if (connection.expiresAt <= fiveMinutesFromNow) {
        this.logger.log(`[Shopify] Token expirando para ${connection.shop}. Renovando...`);
        const newTokens = await this.refreshAccessToken(connection);
        return newTokens.access_token;
      }
    }

    return this.decryptToken(connection.accessToken);
  }

  /**
   * Renova o token de acesso usando o refresh token
   */
  private async refreshAccessToken(connection: ShopifyConnection): Promise<any> {
    if (!connection.refreshToken) {
      throw new Error('Refresh token missing');
    }
    const refreshToken = this.decryptToken(connection.refreshToken);
    
    const response = await fetch(`https://${connection.shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      this.logger.error(`[Shopify] Falha ao renovar token para ${connection.shop}: ${JSON.stringify(error)}`);
      
      // Se o erro for que o refresh token é inválido, desativar a conexão
      if (response.status === 400 || response.status === 401) {
        connection.isActive = false;
        await this.shopifyConnectionRepository.save(connection);
      }
      
      throw new UnauthorizedException('Falha ao renovar conexão com Shopify. Por favor, reconecte sua loja.');
    }

    const data = await response.json();
    
    // Atualizar a conexão com o novo token
    connection.accessToken = this.encryptToken(data.access_token);
    if (data.refresh_token) {
      connection.refreshToken = this.encryptToken(data.refresh_token);
    }
    if (data.expires_in) {
      connection.expiresAt = new Date(Date.now() + data.expires_in * 1000);
    }
    connection.lastSyncAt = new Date();
    
    await this.shopifyConnectionRepository.save(connection);
    
    return data;
  }

  /**
   * Sincroniza produtos usando GraphQL productSet
   */
  async syncProduct(
    userId: number,
    shop: string,
    productData: {
      title: string;
      productOptions?: Array<{ name: string; values: string[] }>;
      variants?: Array<{
        optionValues: Array<{ optionName: string; name: string }>;
        price: string;
        sku?: string;
      }>;
      id?: string;
    },
  ): Promise<any> {
    const accessToken = await this.getAccessToken(userId, shop);

    const mutation = `
      mutation productSet($input: ProductSetInput!) {
        productSet(input: $input) {
          product {
            id
            title
            handle
            status
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const variables = {
      input: {
        title: productData.title,
        ...(productData.id && { id: productData.id }),
        ...(productData.productOptions && {
          productOptions: productData.productOptions,
        }),
        ...(productData.variants && { variants: productData.variants }),
      },
    };

    const response = await fetch(
      `https://${shop}/admin/api/${this.apiVersion}/graphql.json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': accessToken,
        },
        body: JSON.stringify({
          query: mutation,
          variables,
        }),
      },
    );

    if (!response.ok) {
      throw new BadRequestException('Falha ao sincronizar produto');
    }

    const result = await response.json();

    if (result.errors) {
      throw new BadRequestException(result.errors[0].message);
    }

    if (result.data?.productSet?.userErrors?.length > 0) {
      throw new BadRequestException(
        result.data.productSet.userErrors[0].message,
      );
    }

    return result.data?.productSet?.product;
  }

  /**
   * Busca produtos via GraphQL e mapeia para o shape REST usado internamente
   * (id numérico, variants[].{price,sku,inventory_quantity}, images[].src).
   * `all=true` pagina por cursor até o fim; senão retorna a primeira página.
   */
  private async fetchProductsGraphql(
    shop: string,
    accessToken: string,
    opts?: { limit?: number; all?: boolean },
  ): Promise<any[]> {
    const pageSize = Math.min(opts?.limit || 250, 250);
    let cursor: string | null = null;
    let hasNext = true;
    const out: any[] = [];

    const query = `
      query Products($cursor: String, $n: Int!) {
        products(first: $n, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            title
            handle
            status
            featuredImage { url }
            variants(first: 100) { nodes { id title price sku inventoryQuantity } }
          }
        }
      }`;

    while (hasNext) {
      const result = await this.makeGraphqlRequest(shop, accessToken, query, { cursor, n: pageSize });
      const conn = result.data?.products;
      if (!conn) break;

      for (const p of conn.nodes || []) {
        const variants = (p.variants?.nodes || []).map((v: any) => ({
          id: v.id ? this.gidToId(v.id) : null,
          title: v.title ?? null,
          price: v.price ?? '0',
          sku: v.sku ?? '',
          inventory_quantity: v.inventoryQuantity ?? 0,
        }));

        out.push({
          id: this.gidToId(p.id),
          title: p.title,
          handle: p.handle,
          status: p.status,
          images: p.featuredImage?.url ? [{ src: p.featuredImage.url }] : [],
          // Todas as variantes (antes só a primeira era importada).
          variants: variants.length > 0
            ? variants
            : [{ id: null, title: null, price: '0', sku: '', inventory_quantity: 0 }],
        });
      }

      hasNext = !!opts?.all && conn.pageInfo?.hasNextPage;
      cursor = conn.pageInfo?.endCursor ?? null;
    }

    return out;
  }

  /**
   * Busca produtos da loja Shopify (primeira página)
   */
  async getProducts(
    userId: number,
    shop: string,
    params?: {
      limit?: number;
      page?: number;
    },
  ): Promise<any[]> {
    const accessToken = await this.getAccessToken(userId, shop);
    return this.fetchProductsGraphql(shop, accessToken, { limit: params?.limit, all: false });
  }

  /**
   * Busca carrinhos abandonados
   */
  async getAbandonedCheckouts(
    userId: number,
    shop: string,
    params?: {
      limit?: number;
      all?: boolean;
      created_at_min?: string;
      created_at_max?: string;
      status?: 'open' | 'closed';
    },
  ): Promise<any> {
    const accessToken = await this.getAccessToken(userId, shop);
    const pageSize = Math.min(params?.limit || 250, 250);

    const query = `
      query AbandonedCheckouts($cursor: String, $n: Int!) {
        abandonedCheckouts(first: $n, after: $cursor, sortKey: CREATED_AT, reverse: true) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            createdAt
            completedAt
            customer { firstName lastName ${this.customerContactFields()} }
            billingAddress { firstName lastName phone }
            shippingAddress { firstName lastName phone }
            lineItems(first: 100) {
              nodes {
                title
                quantity
                variant { sku price }
              }
            }
          }
        }
      }`;

    const addr = (a: any) => (a ? { first_name: a.firstName, last_name: a.lastName, phone: a.phone } : null);
    const out: any[] = [];
    let cursor: string | null = null;
    let hasNext = true;

    while (hasNext) {
      const result = await this.makeGraphqlRequest(shop, accessToken, query, { cursor, n: pageSize });
      const conn = result.data?.abandonedCheckouts;
      if (!conn) break;

      // Mapeia para o shape REST consumido por syncCheckouts. A conexão
      // `abandonedCheckouts` já exclui carrinhos ativos; um `completedAt`
      // preenchido significa checkout RECUPERADO (virou pedido) — não abandonado.
      for (const c of conn.nodes || []) {
        const customerContact = this.mapCustomerContact(c.customer);
        out.push({
          id: this.gidToId(c.id),
          token: null,
          created_at: c.createdAt,
          completed_at: c.completedAt || null,
          status: c.completedAt ? 'recovered' : 'abandoned',
          email: customerContact.email,
          customer: c.customer
            ? {
                email: customerContact.email,
                first_name: c.customer.firstName,
                last_name: c.customer.lastName,
                name: [c.customer.firstName, c.customer.lastName].filter(Boolean).join(' '),
                phone: customerContact.phone,
              }
            : null,
          billing_address: addr(c.billingAddress),
          shipping_address: addr(c.shippingAddress),
          line_items: (c.lineItems?.nodes || []).map((li: any) => ({
            sku: li.variant?.sku || '',
            name: li.title,
            title: li.title,
            price: li.variant?.price ?? '0',
            quantity: li.quantity,
          })),
        });
      }

      hasNext = !!params?.all && !!conn.pageInfo?.hasNextPage;
      cursor = conn.pageInfo?.endCursor ?? null;
    }

    return out;
  }

  /**
   * Converte 'orders/create' → 'ORDERS_CREATE' (enum WebhookSubscriptionTopic).
   */
  private toWebhookTopicEnum(topic: string): string {
    return String(topic || '').toUpperCase().replace(/[\/\-.]/g, '_');
  }

  /**
   * Cria um webhook na Shopify via GraphQL.
   *
   * Os webhooks principais do app são declarados no `shopify.app.toml`
   * (app-managed) e não precisam ser criados aqui — este método existe para
   * assinaturas pontuais por loja.
   */
  async createWebhook(
    userId: number,
    shop: string,
    topic: string,
    address: string,
  ): Promise<any> {
    const accessToken = await this.getAccessToken(userId, shop);

    const mutation = `
      mutation WebhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
        webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
          webhookSubscription { id topic endpoint { __typename ... on WebhookHttpEndpoint { callbackUrl } } }
          userErrors { field message }
        }
      }
    `;

    const result = await this.makeGraphqlRequest(shop, accessToken, mutation, {
      topic: this.toWebhookTopicEnum(topic),
      webhookSubscription: { callbackUrl: address, format: 'JSON' },
    });

    const payload = result.data?.webhookSubscriptionCreate;
    const userErrors = payload?.userErrors || [];
    if (userErrors.length > 0) {
      this.logger.error(`[Shopify Webhook] userError ao criar webhook em ${shop}: ${userErrors[0].message}`);
      throw new BadRequestException(userErrors[0].message);
    }
    if (!payload?.webhookSubscription) {
      throw new BadRequestException('Falha ao criar webhook');
    }

    const sub = payload.webhookSubscription;
    // Mantém o shape REST consumido pelo controller/frontend.
    return {
      id: this.gidToId(sub.id),
      topic: String(sub.topic || '').toLowerCase().replace(/_/g, '/'),
      address: sub.endpoint?.callbackUrl || address,
      format: 'json',
    };
  }

  /**
   * Lista webhooks existentes via GraphQL.
   */
  async listWebhooks(userId: number, shop: string): Promise<any[]> {
    const accessToken = await this.getAccessToken(userId, shop);

    const query = `
      query WebhookSubscriptions($cursor: String) {
        webhookSubscriptions(first: 100, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            topic
            createdAt
            updatedAt
            endpoint { __typename ... on WebhookHttpEndpoint { callbackUrl } }
          }
        }
      }
    `;

    const out: any[] = [];
    let cursor: string | null = null;
    let hasNext = true;

    while (hasNext) {
      const result = await this.makeGraphqlRequest(shop, accessToken, query, { cursor });
      const conn = result.data?.webhookSubscriptions;
      if (!conn) break;

      for (const w of conn.nodes || []) {
        out.push({
          id: this.gidToId(w.id),
          topic: String(w.topic || '').toLowerCase().replace(/_/g, '/'),
          address: w.endpoint?.callbackUrl || null,
          format: 'json',
          created_at: w.createdAt,
          updated_at: w.updatedAt,
        });
      }

      hasNext = !!conn.pageInfo?.hasNextPage;
      cursor = conn.pageInfo?.endCursor ?? null;
    }

    return out;
  }

  /**
   * Verifica a assinatura HMAC de um webhook
   */
  verifyWebhookSignature(
    body: string | Buffer,
    signature: string,
    secret: string,
  ): boolean {
    if (!signature || !secret) return false;

    const hmac = crypto
      .createHmac('sha256', secret)
      .update(body)
      .digest('base64');

    try {
      return crypto.timingSafeEqual(
        Buffer.from(hmac),
        Buffer.from(signature),
      );
    } catch (e) {
      return false;
    }
  }

  /**
   * Processa webhooks de conformidade obrigatórios (GDPR/CCPA).
   * Estes tópicos são exigidos e TESTADOS pela Shopify na revisão do app.
   *
   *  - customers/data_request: merchant pediu os dados de um cliente
   *  - customers/redact: excluir os dados de um cliente específico
   *  - shop/redact: excluir todos os dados da loja (48h após desinstalação)
   */
  async handleComplianceWebhook(topic: string, shop: string, data: any): Promise<void> {
    this.logger.log(`[Shopify Compliance] Recebido tópico "${topic}" para loja ${shop}`);

    if (topic === 'customers/data_request') {
      await this.handleCustomerDataRequest(shop, data);
    } else if (topic === 'customers/redact') {
      await this.redactCustomer(shop, data);
    } else if (topic === 'shop/redact') {
      await this.redactShop(shop);
    } else {
      this.logger.warn(`[Shopify Compliance] Tópico de compliance não reconhecido: ${topic}`);
    }
  }

  /**
   * Resolve os usuários do CRM vinculados a uma loja Shopify (ativos ou não).
   */
  private async findUserIdsByShop(shop: string): Promise<number[]> {
    const connections = await this.shopifyConnectionRepository.find({ where: { shop } });
    return [...new Set(connections.map((c) => c.userId))];
  }

  /**
   * Lista as solicitações de dados da conta (sem o payload, que é volumoso).
   */
  async listDataRequests(userId: number): Promise<any[]> {
    const requests = await this.dataRequestRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: 200,
    });

    return requests.map((r) => ({
      id: r.id,
      shop: r.shop,
      shopifyCustomerId: r.shopifyCustomerId,
      customerEmail: r.customerEmail,
      status: r.status,
      contactsCount: r.payload?.contacts?.length ?? 0,
      salesCount: r.payload?.sales?.length ?? 0,
      createdAt: r.createdAt,
    }));
  }

  /**
   * Conteúdo completo de uma solicitação. Só o dono da conexão pode ver —
   * o payload contém PII do cliente final.
   */
  async getDataRequest(userId: number, id: number): Promise<ShopifyDataRequest> {
    const request = await this.dataRequestRepository.findOne({ where: { id } });
    if (!request || request.userId !== userId) {
      throw new NotFoundException('Solicitação de dados não encontrada');
    }
    return request;
  }

  /**
   * Normaliza um telefone para comparação (só dígitos, sem DDI/formatação).
   */
  private normalizePhone(phone?: string | null): string {
    return String(phone || '').replace(/\D/g, '');
  }

  /**
   * Localiza os contatos de um cliente da loja dentro de um usuário do CRM.
   *
   * Casa por id da Shopify, e-mail e telefone — o cliente pode ter trocado de
   * e-mail depois da importação, e nem todo contato tem `source = 'shopify'`
   * (pode ter chegado por pedido, checkout ou importação manual).
   */
  private async findCustomerContacts(
    userId: number,
    identity: { shopifyCustomerId?: string | null; email?: string | null; phone?: string | null },
  ): Promise<Contact[]> {
    const where: any[] = [];
    if (identity.shopifyCustomerId) where.push({ userId, externalId: identity.shopifyCustomerId });
    if (identity.email) where.push({ userId, email: identity.email });
    if (where.length === 0 && !identity.phone) return [];

    const found = where.length > 0 ? await this.contactRepository.find({ where }) : [];

    // Telefone: os formatos divergem (DDI, máscara), então a comparação é feita
    // sobre os dígitos. Normalizar no banco evita carregar a base inteira —
    // REPLACE aninhado remove os separadores mais comuns antes do LIKE.
    const normalizedPhone = this.normalizePhone(identity.phone);
    if (normalizedPhone.length >= 8) {
      const digitsOnly = `REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(contact.phone, ' ', ''), '-', ''), '(', ''), ')', ''), '+', '')`;
      const byPhone = await this.contactRepository
        .createQueryBuilder('contact')
        .where('contact.userId = :userId', { userId })
        .andWhere('contact.phone IS NOT NULL')
        .andWhere(`${digitsOnly} LIKE :phone`, { phone: `%${normalizedPhone}` })
        .getMany();

      for (const c of byPhone) {
        if (!found.some((f) => f.id === c.id)) found.push(c);
      }
    }

    return found;
  }

  /**
   * Extrai a identidade do cliente do payload de compliance da Shopify.
   */
  private extractCustomerIdentity(data: any): {
    shopifyCustomerId: string | null;
    email: string | null;
    phone: string | null;
  } {
    return {
      shopifyCustomerId: data?.customer?.id ? String(data.customer.id) : null,
      email: (data?.customer?.email || '').toLowerCase().trim() || null,
      phone: data?.customer?.phone || null,
    };
  }

  /**
   * customers/data_request — o merchant pediu os dados que guardamos do cliente.
   *
   * Monta um export com tudo que o app tem sobre esse cliente (contato,
   * consentimento, vendas) e registra em `shopify_data_requests`, de onde o
   * merchant baixa por endpoint autenticado. O prazo da Shopify é de 30 dias.
   */
  private async handleCustomerDataRequest(shop: string, data: any): Promise<void> {
    const identity = this.extractCustomerIdentity(data);
    const userIds = await this.findUserIdsByShop(shop);

    if (userIds.length === 0) {
      await this.dataRequestRepository.save(
        this.dataRequestRepository.create({
          shop,
          userId: null,
          shopifyCustomerId: identity.shopifyCustomerId,
          customerEmail: identity.email,
          status: 'no_data',
          payload: { note: 'Nenhuma conexão do CRM para esta loja.' },
        }),
      );
      this.logger.warn(`[Shopify Compliance] data_request: nenhuma conexão para loja ${shop}.`);
      return;
    }

    for (const userId of userIds) {
      const contacts = await this.findCustomerContacts(userId, identity);
      const contactIds = contacts.map((c) => c.id);

      // Vendas ligadas ao contato OU ao e-mail (vendas importadas antes do vínculo).
      const salesQuery = this.saleRepository
        .createQueryBuilder('sale')
        .where('sale.userId = :userId', { userId });
      if (contactIds.length > 0 && identity.email) {
        salesQuery.andWhere('(sale.contactId IN (:...contactIds) OR sale.customerEmail = :email)', {
          contactIds,
          email: identity.email,
        });
      } else if (contactIds.length > 0) {
        salesQuery.andWhere('sale.contactId IN (:...contactIds)', { contactIds });
      } else if (identity.email) {
        salesQuery.andWhere('sale.customerEmail = :email', { email: identity.email });
      } else {
        salesQuery.andWhere('1 = 0');
      }
      const sales = await salesQuery.getMany();

      const hasData = contacts.length > 0 || sales.length > 0;

      const payload = {
        generatedAt: new Date().toISOString(),
        shop,
        requestedCustomer: identity,
        contacts: contacts.map((c) => ({
          name: c.name,
          email: c.email,
          phone: c.phone,
          city: c.city,
          state: c.state,
          status: c.status,
          source: c.source,
          shopifyCustomerId: c.externalId,
          marketingConsent: { email: c.emailOptIn, sms: c.smsOptIn },
          createdAt: c.createdAt,
        })),
        sales: sales.map((s) => ({
          externalId: s.externalId,
          productId: s.productId,
          quantity: s.quantity,
          unitPrice: s.unitPrice,
          totalValue: s.totalValue,
          status: s.status,
          channel: s.channel,
          paymentMethod: s.paymentMethod,
          couponCode: s.couponCode,
          createdAt: s.createdAt,
        })),
      };

      const saved = await this.dataRequestRepository.save(
        this.dataRequestRepository.create({
          shop,
          userId,
          shopifyCustomerId: identity.shopifyCustomerId,
          customerEmail: identity.email,
          status: hasData ? 'completed' : 'no_data',
          payload,
        }),
      );

      // Avisar o merchant: o prazo de resposta é dele, não nosso.
      await this.notificationsService
        .create({
          userId,
          title: 'Solicitação de dados de cliente (Shopify)',
          message:
            `A loja ${shop} recebeu uma solicitação de dados do cliente ` +
            `${identity.email || identity.shopifyCustomerId || 'desconhecido'}. ` +
            `O relatório está disponível para download em Integrações → Shopify. ` +
            `Responda ao cliente em até 30 dias.`,
          type: NotificationType.SECURITY,
        })
        .catch((e) => this.logger.error(`[Shopify Compliance] Falha ao notificar userId ${userId}: ${e.message}`));

      this.logger.log(
        `[Shopify Compliance] data_request loja=${shop} userId=${userId} — export #${saved.id} ` +
        `(${payload.contacts.length} contato(s), ${payload.sales.length} venda(s)).`,
      );
    }
  }

  /**
   * customers/redact — exclui TUDO que o app guarda de um cliente da loja.
   *
   * Casa o cliente por id da Shopify, e-mail e telefone (não só e-mail: o
   * cliente pode tê-lo trocado) e remove contato, vendas, dados derivados
   * (compras, eventos de campanha) e os logs de webhook que o citam.
   */
  private async redactCustomer(shop: string, data: any): Promise<void> {
    const identity = this.extractCustomerIdentity(data);
    if (!identity.email && !identity.shopifyCustomerId && !identity.phone) {
      this.logger.warn(`[Shopify Compliance] customers/redact sem identificação para loja ${shop}; nada a excluir.`);
      return;
    }

    const userIds = await this.findUserIdsByShop(shop);
    if (userIds.length === 0) {
      this.logger.warn(`[Shopify Compliance] customers/redact: nenhuma conexão para loja ${shop}.`);
      return;
    }

    let deletedSales = 0;
    let deletedContacts = 0;

    for (const userId of userIds) {
      const contacts = await this.findCustomerContacts(userId, identity);
      const contactIds = contacts.map((c) => c.id);

      // 1. Vendas: por contato e por e-mail (cobre vendas ainda não vinculadas).
      if (contactIds.length > 0) {
        const r = await this.saleRepository.delete({ userId, contactId: In(contactIds) });
        deletedSales += r.affected || 0;
      }
      if (identity.email) {
        const r = await this.saleRepository.delete({ userId, customerEmail: identity.email });
        deletedSales += r.affected || 0;
      }

      // Exports gerados por customers/data_request também contêm PII. Um
      // customers/redact precisa removê-los; apagar só contato/venda deixaria
      // nome, e-mail, telefone e histórico preservados no JSON do export.
      if (identity.shopifyCustomerId) {
        await this.dataRequestRepository.delete({
          shop,
          userId,
          shopifyCustomerId: identity.shopifyCustomerId,
        });
      }
      if (identity.email) {
        await this.dataRequestRepository.delete({
          shop,
          userId,
          customerEmail: identity.email,
        });
      }

      // 2. Dados derivados do contato (histórico de compras e eventos de campanha).
      //    campaign_queue e campaign_clicks caem por FK CASCADE.
      if (contactIds.length > 0) {
        await this.contactPurchaseRepository.delete({ contactId: In(contactIds) });
        await this.campaignMessageEventRepository.delete({ contactId: In(contactIds) });
      }

      // 3. O contato em si.
      if (contactIds.length > 0) {
        const r = await this.contactRepository.delete({ id: In(contactIds) });
        deletedContacts += r.affected || 0;
      }

      // 4. Logs de webhook que citam o cliente (payload guarda PII).
      await this.deleteWebhookLogsMentioning(userId, identity);
    }

    this.logger.log(
      `[Shopify Compliance] customers/redact loja=${shop} cliente=${identity.email || identity.shopifyCustomerId} — ` +
      `${deletedContacts} contato(s) e ${deletedSales} venda(s) excluído(s).`,
    );
  }

  /**
   * Remove logs de webhook cujo payload contenha o e-mail ou o id do cliente.
   * Sem isso, a PII sobreviveria ao redact dentro dos logs brutos.
   */
  private async deleteWebhookLogsMentioning(
    userId: number,
    identity: { shopifyCustomerId?: string | null; email?: string | null },
  ): Promise<void> {
    const terms: string[] = [];
    if (identity.email) terms.push(identity.email);
    if (identity.shopifyCustomerId) terms.push(`"id":${identity.shopifyCustomerId}`);
    if (terms.length === 0) return;

    // O LIKE sobre o payload não usa índice, então o escopo é reduzido antes:
    // só logs deste usuário e de origem Shopify (os únicos que podem conter
    // dados de cliente da loja).
    const qb = this.webhookLogRepository
      .createQueryBuilder()
      .delete()
      .where('userId = :userId', { userId })
      .andWhere('source IN (:...sources)', { sources: ['shopify', 'shopify-billing'] });

    qb.andWhere(
      new Brackets((b) => {
        terms.forEach((term, i) => {
          b.orWhere(`CAST(payload AS CHAR) LIKE :term${i}`, { [`term${i}`]: `%${term}%` });
        });
      }),
    );

    const result = await qb.execute().catch((e) => {
      this.logger.error(`[Shopify Compliance] Falha ao limpar logs de webhook: ${e.message}`);
      return { affected: 0 } as any;
    });

    if (result.affected) {
      this.logger.log(`[Shopify Compliance] ${result.affected} log(s) de webhook com PII do cliente removido(s).`);
    }
  }

  /**
   * shop/redact — exclui todos os dados que o app guarda da loja.
   * Enviado ~48h após a desinstalação. Remove vendas/contatos de origem Shopify,
   * limpa a referência da loja nos produtos e apaga as conexões.
   */
  private async redactShop(shop: string): Promise<void> {
    const userIds = await this.findUserIdsByShop(shop);
    if (userIds.length === 0) {
      this.logger.warn(`[Shopify Compliance] shop/redact: nenhuma conexão para loja ${shop}.`);
      return;
    }

    for (const userId of userIds) {
      // Dados derivados dos contatos da loja precisam sair ANTES do contato
      // (contact_purchases não tem CASCADE e bloquearia a exclusão).
      const shopifyContacts = await this.contactRepository.find({
        where: { userId, source: 'shopify' },
        select: ['id'],
      });
      const contactIds = shopifyContacts.map((c) => c.id);
      if (contactIds.length > 0) {
        await this.contactPurchaseRepository.delete({ contactId: In(contactIds) });
        await this.campaignMessageEventRepository.delete({ contactId: In(contactIds) });
      }

      await this.saleRepository.delete({ userId, channel: 'shopify' });
      await this.contactRepository.delete({ userId, source: 'shopify' });

      // Logs de webhook desta loja: os payloads guardam PII dos clientes.
      await this.webhookLogRepository
        .createQueryBuilder()
        .delete()
        .where('userId = :userId', { userId })
        .andWhere('source IN (:...sources)', { sources: ['shopify', 'shopify-billing'] })
        .execute()
        .catch((e) => this.logger.error(`[Shopify Compliance] Falha ao limpar logs da loja: ${e.message}`));

      // Solicitações de dados (exports) guardam PII do cliente exportado.
      await this.dataRequestRepository.delete({ shop, userId });

      // Remove a referência desta loja nos produtos (mantém o produto no CRM).
      const products = await this.productRepository
        .createQueryBuilder('product')
        .where('product.userId = :userId', { userId })
        .andWhere(`JSON_EXTRACT(product.externalIds, :jsonPath) IS NOT NULL`, {
          jsonPath: `$.shopify."${shop}"`,
        })
        .getMany();

      for (const product of products) {
        const externalIds = product.externalIds || {};
        if (externalIds.shopify && externalIds.shopify[shop]) {
          delete externalIds.shopify[shop];
          if (Object.keys(externalIds.shopify).length === 0) delete externalIds.shopify;
          product.externalIds = externalIds;
          await this.productRepository.save(product);
        }
      }
    }

    // Registros de dedupe de webhooks desta loja.
    await this.webhookEventRepository.delete({ shop });

    // Apaga as conexões (tokens) da loja por completo.
    await this.shopifyConnectionRepository.delete({ shop });

    this.logger.log(`[Shopify Compliance] shop/redact concluído para loja ${shop} (${userIds.length} usuário(s)).`);
  }

  /**
   * app/uninstalled — o merchant desinstalou o app.
   * Desativa a conexão e descarta os tokens (que são invalidados pela Shopify).
   * A exclusão definitiva dos dados ocorre depois via shop/redact.
   */
  async handleAppUninstalled(shop: string): Promise<void> {
    const connections = await this.shopifyConnectionRepository.find({ where: { shop } });
    if (connections.length === 0) {
      this.logger.warn(`[Shopify] app/uninstalled: nenhuma conexão para loja ${shop}.`);
      return;
    }

    for (const connection of connections) {
      connection.isActive = false;
      connection.accessToken = null as any;
      connection.refreshToken = null;
      connection.expiresAt = null;
      await this.shopifyConnectionRepository.save(connection);
    }

    this.logger.log(`[Shopify] app/uninstalled: ${connections.length} conexão(ões) desativada(s) para loja ${shop}.`);

    // A Shopify cancela a AppSubscription junto com a desinstalação, mas o webhook
    // app_subscriptions/update pode não chegar depois dela. Sem cancelar aqui, a
    // reinstalação encontraria a assinatura local "ativa" e não pediria nova
    // aprovação de cobrança (App Store requirement 1.2.2).
    const userIds = [...new Set(connections.map((c) => c.userId).filter((id) => id != null))];
    for (const userId of userIds) {
      await this.cancelShopifyBillingOnUninstall(userId, shop);
    }
  }

  private async cancelShopifyBillingOnUninstall(userId: number, shop: string): Promise<void> {
    // A assinatura não guarda a loja; se o usuário ainda tem outra loja Shopify
    // ativa, a cobrança pode pertencer a ela e não deve ser derrubada.
    const otherActiveShop = await this.shopifyConnectionRepository.findOne({
      where: { userId, isActive: true },
    });
    if (otherActiveShop) {
      this.logger.warn(
        `[Shopify] app/uninstalled: userId ${userId} ainda tem a loja ${otherActiveShop.shop} ativa; assinatura mantida.`,
      );
      return;
    }

    const subscriptions = await this.subscriptionRepository.find({
      where: { userId, status: In(['active', 'frozen', 'past_due', 'incomplete']) },
    });
    const shopifySubscriptions = subscriptions.filter((s) => !!s.shopifySubscriptionId);
    if (shopifySubscriptions.length === 0) return;

    for (const subscription of shopifySubscriptions) {
      subscription.status = 'canceled';
      subscription.cancelAtPeriodEnd = false;
      subscription.cancellationReason = 'app_uninstalled';
      await this.subscriptionRepository.save(subscription);
    }
    await this.userRepository.update(userId, { subscriptionStatus: 'inactive' });

    this.logger.log(
      `[Shopify] app/uninstalled: ${shopifySubscriptions.length} assinatura(s) Shopify cancelada(s) para userId ${userId} (loja ${shop}).`,
    );
  }

  /**
   * Busca todas as conexões do usuário
   */
  async getConnections(userId: number): Promise<ShopifyConnection[]> {
    return await this.shopifyConnectionRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Desativa uma conexão
   */
  async deactivateConnection(
    userId: number,
    shop: string,
  ): Promise<void> {
    const connection = await this.getActiveConnection(userId, shop);
    connection.isActive = false;
    await this.shopifyConnectionRepository.save(connection);
  }

  /**
   * Busca clientes da loja Shopify
   */
  async getCustomers(
    userId: number,
    shop: string,
    params?: { limit?: number; all?: boolean; updatedSince?: Date | null },
  ): Promise<any[]> {
    const accessToken = await this.getAccessToken(userId, shop);
    const pageSize = Math.min(params?.limit || 250, 250);
    const searchQuery = this.updatedSinceFilter(params?.updatedSince);

    // `all` pagina por cursor até o fim; sem isso a loja "acaba" em 250 clientes.
    const query = `
      query Customers($cursor: String, $n: Int!, $q: String) {
        customers(first: $n, after: $cursor, query: $q) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            firstName
            lastName
            ${this.customerContactFields()}
            defaultAddress { city provinceCode }
          }
        }
      }`;

    const out: any[] = [];
    let cursor: string | null = null;
    let hasNext = true;

    while (hasNext) {
      const result = await this.makeGraphqlRequest(shop, accessToken, query, { cursor, n: pageSize, q: searchQuery });
      const conn = result.data?.customers;
      if (!conn) break;

      // Mapeia para o shape REST usado por syncCustomers.
      for (const c of conn.nodes || []) {
        const contact = this.mapCustomerContact(c);
        out.push({
          id: this.gidToId(c.id),
          email: contact.email,
          first_name: c.firstName,
          last_name: c.lastName,
          phone: contact.phone,
          // Consentimento de marketing: SUBSCRIBED é o único estado que autoriza envio.
          email_marketing_state: contact.emailMarketingState,
          sms_marketing_state: contact.smsMarketingState,
          default_address: c.defaultAddress
            ? { city: c.defaultAddress.city, province_code: c.defaultAddress.provinceCode }
            : null,
        });
      }

      hasNext = !!params?.all && !!conn.pageInfo?.hasNextPage;
      cursor = conn.pageInfo?.endCursor ?? null;
    }

    return out;
  }

  /**
   * Busca pedidos da loja Shopify
   */
  /**
   * Campos de line item usados tanto na query de pedidos quanto na paginação
   * extra de itens (pedidos com mais de 100 linhas).
   */
  private readonly ORDER_LINE_ITEM_FIELDS = `
    id
    sku
    name
    title
    quantity
    currentQuantity
    variant { id }
    originalUnitPriceSet { shopMoney { amount currencyCode } }
    discountedUnitPriceSet { shopMoney { amount currencyCode } }
  `;

  private mapOrderLineItem(li: any): any {
    // `currentQuantity` reflete edições/reembolsos parciais; `quantity` é o original.
    const currentQuantity = li.currentQuantity ?? li.quantity;
    // Preço com descontos rateados — é o que o cliente realmente pagou por unidade.
    const unitPrice =
      li.discountedUnitPriceSet?.shopMoney?.amount ??
      li.originalUnitPriceSet?.shopMoney?.amount ??
      '0';
    return {
      id: this.gidToId(li.id),
      variant_id: li.variant?.id ? this.gidToId(li.variant.id) : null,
      sku: li.sku,
      name: li.name,
      title: li.title,
      quantity: currentQuantity,
      original_quantity: li.quantity,
      price: unitPrice,
      original_price: li.originalUnitPriceSet?.shopMoney?.amount ?? '0',
      currency: li.discountedUnitPriceSet?.shopMoney?.currencyCode
        ?? li.originalUnitPriceSet?.shopMoney?.currencyCode
        ?? null,
    };
  }

  /**
   * Busca as linhas restantes de um pedido com mais de 100 itens.
   */
  private async fetchRemainingLineItems(
    shop: string,
    accessToken: string,
    orderGid: string,
    startCursor: string,
  ): Promise<any[]> {
    const query = `
      query OrderLineItems($id: ID!, $cursor: String) {
        order(id: $id) {
          lineItems(first: 100, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            nodes { ${this.ORDER_LINE_ITEM_FIELDS} }
          }
        }
      }`;

    const out: any[] = [];
    let cursor: string | null = startCursor;
    let hasNext = true;

    while (hasNext) {
      const result = await this.makeGraphqlRequest(shop, accessToken, query, { id: orderGid, cursor });
      const conn = result.data?.order?.lineItems;
      if (!conn) break;
      for (const li of conn.nodes || []) out.push(this.mapOrderLineItem(li));
      hasNext = !!conn.pageInfo?.hasNextPage;
      cursor = conn.pageInfo?.endCursor ?? null;
    }

    return out;
  }

  /**
   * Filtro de busca da Shopify para trazer só o que mudou desde a última
   * sincronização. Sem isso, cada sync varre a loja inteira — em lojas grandes
   * isso custa minutos e rate limit à toa.
   */
  private updatedSinceFilter(since?: Date | null): string {
    if (!since) return '';
    // Uma folga de 1 minuto cobre diferenças de relógio entre nós e a Shopify.
    const safe = new Date(since.getTime() - 60 * 1000).toISOString();
    return `updated_at:>='${safe}'`;
  }

  async getOrders(
    userId: number,
    shop: string,
    params?: { limit?: number; status?: string; all?: boolean; updatedSince?: Date | null },
  ): Promise<any[]> {
    const accessToken = await this.getAccessToken(userId, shop);
    const pageSize = Math.min(params?.limit || 250, 250);
    const searchQuery = this.updatedSinceFilter(params?.updatedSince);

    const query = `
      query Orders($cursor: String, $n: Int!, $q: String) {
        orders(first: $n, after: $cursor, sortKey: CREATED_AT, reverse: true, query: $q) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            name
            email
            createdAt
            cancelledAt
            displayFinancialStatus
            displayFulfillmentStatus
            paymentGatewayNames
            discountCodes
            currencyCode
            currentTotalPriceSet { shopMoney { amount currencyCode } }
            totalPriceSet { shopMoney { amount currencyCode } }
            totalRefundedSet { shopMoney { amount } }
            customer { id firstName lastName ${this.customerContactFields()} }
            lineItems(first: 100) {
              pageInfo { hasNextPage endCursor }
              nodes { ${this.ORDER_LINE_ITEM_FIELDS} }
            }
          }
        }
      }`;

    const out: any[] = [];
    let cursor: string | null = null;
    let hasNext = true;

    while (hasNext) {
      const result = await this.makeGraphqlRequest(shop, accessToken, query, { cursor, n: pageSize, q: searchQuery });
      const conn = result.data?.orders;
      if (!conn) break;

      // Mapeia para o shape REST consumido por syncOrders.
      for (const o of conn.nodes || []) {
        const orderCustomer = this.mapCustomerContact(o.customer);
        const first = o.customer?.firstName || '';
        const last = o.customer?.lastName || '';
        const gateways: string[] = o.paymentGatewayNames || [];

        const lineItems = (o.lineItems?.nodes || []).map((li: any) => this.mapOrderLineItem(li));
        // Pedido com mais de 100 linhas: buscar o restante por cursor.
        if (o.lineItems?.pageInfo?.hasNextPage) {
          const rest = await this.fetchRemainingLineItems(
            shop,
            accessToken,
            o.id,
            o.lineItems.pageInfo.endCursor,
          );
          lineItems.push(...rest);
        }

        out.push({
          id: this.gidToId(o.id),
          name: o.name,
          email: o.email,
          created_at: o.createdAt,
          cancelled_at: o.cancelledAt,
          financial_status: o.displayFinancialStatus ? String(o.displayFinancialStatus).toLowerCase() : null,
          fulfillment_status: o.displayFulfillmentStatus ? String(o.displayFulfillmentStatus).toLowerCase() : null,
          gateway: gateways[0] || null,
          payment_gateway_names: gateways,
          discount_codes: (o.discountCodes || []).map((c: string) => ({ code: c })),
          currency: o.currencyCode || null,
          // `current_total_price` já desconta reembolsos e edições do pedido.
          current_total_price: o.currentTotalPriceSet?.shopMoney?.amount ?? null,
          total_price: o.totalPriceSet?.shopMoney?.amount ?? null,
          total_refunded: o.totalRefundedSet?.shopMoney?.amount ?? '0',
          customer: o.customer
            ? {
                id: this.gidToId(o.customer.id),
                email: orderCustomer.email,
                first_name: first,
                last_name: last,
                name: [first, last].filter(Boolean).join(' '),
                phone: orderCustomer.phone,
              }
            : null,
          line_items: lineItems,
        });
      }

      hasNext = !!params?.all && !!conn.pageInfo?.hasNextPage;
      cursor = conn.pageInfo?.endCursor ?? null;
    }

    return out;
  }

  /**
   * Sincroniza clientes da Shopify para o CRM
   */
  async syncCustomers(
    userId: number,
    shop: string,
    updatedSince?: Date | null,
  ): Promise<{ imported: number; updated: number }> {
    // Sync incremental: a partir da segunda execução, só o que mudou desde a
    // última. A primeira varre tudo (lastSyncAt nulo). Em syncAll a marca é
    // capturada uma vez e repassada — cada sync atualiza lastSyncAt no fim, e
    // ler de novo aqui faria os syncs seguintes acharem que estão em dia.
    const since = updatedSince !== undefined
      ? updatedSince
      : (await this.getActiveConnection(userId, shop)).lastSyncAt;

    const shopifyCustomers = await this.getCustomers(userId, shop, {
      limit: 250,
      all: true,
      updatedSince: since,
    });
    let imported = 0;
    let updated = 0;

    for (const sCustomer of shopifyCustomers) {
      if (!sCustomer.email) continue;

      const normalizedEmail = sCustomer.email.toLowerCase().trim();
      const externalId = sCustomer.id ? String(sCustomer.id) : null;
      // Consentimento: apenas SUBSCRIBED autoriza envio de marketing.
      const emailOptIn = sCustomer.email_marketing_state
        ? String(sCustomer.email_marketing_state).toUpperCase() === 'SUBSCRIBED'
        : null;
      const smsOptIn = sCustomer.sms_marketing_state
        ? String(sCustomer.sms_marketing_state).toUpperCase() === 'SUBSCRIBED'
        : null;

      // Casar por externalId primeiro (sobrevive a troca de e-mail na loja).
      let contact = externalId
        ? await this.contactRepository.findOne({ where: { userId, externalId } })
        : null;
      if (!contact) {
        contact = await this.contactRepository.findOne({
          where: { userId, email: normalizedEmail },
        });
      }

      if (contact) {
        let updatedContact = false;
        if (!contact.name || contact.name === 'Sem Nome') {
          contact.name = [sCustomer.first_name, sCustomer.last_name].filter(Boolean).join(' ') || 'Sem Nome';
          updatedContact = true;
        }
        if (!contact.phone && sCustomer.phone) {
          contact.phone = sCustomer.phone;
          updatedContact = true;
        }
        if (!contact.city && sCustomer.default_address?.city) {
          contact.city = sCustomer.default_address.city;
          updatedContact = true;
        }
        if (!contact.state && sCustomer.default_address?.province_code) {
          contact.state = sCustomer.default_address.province_code;
          updatedContact = true;
        }
        if (!contact.externalId && externalId) {
          contact.externalId = externalId;
          updatedContact = true;
        }
        // Consentimento SEMPRE reflete o estado atual na loja (inclusive descadastro).
        if (emailOptIn !== null && contact.emailOptIn !== emailOptIn) {
          contact.emailOptIn = emailOptIn;
          updatedContact = true;
        }
        if (smsOptIn !== null && contact.smsOptIn !== smsOptIn) {
          contact.smsOptIn = smsOptIn;
          updatedContact = true;
        }
        if (contact.email !== normalizedEmail) {
          contact.email = normalizedEmail;
          updatedContact = true;
        }
        if (updatedContact) {
          await this.contactRepository.save(contact);
        }
        updated++;
      } else {
        contact = this.contactRepository.create({
          userId,
          email: normalizedEmail,
          name: [sCustomer.first_name, sCustomer.last_name].filter(Boolean).join(' ') || 'Sem Nome',
          phone: sCustomer.phone || '',
          city: sCustomer.default_address?.city || '',
          state: sCustomer.default_address?.province_code || '',
          source: 'shopify',
          status: 'customer',
          externalId,
          emailOptIn,
          smsOptIn,
        });
        await this.contactRepository.save(contact);
        imported++;
      }
    }

    const connection = await this.getActiveConnection(userId, shop);
    connection.lastSyncAt = new Date();
    await this.shopifyConnectionRepository.save(connection);

    return { imported, updated };
  }

  /**
   * Sincroniza pedidos da Shopify para o CRM como Vendas
   */
  async syncOrders(
    userId: number,
    shop: string,
    updatedSince?: Date | null,
  ): Promise<{ imported: number; updated: number }> {
    // Sync incremental (ver syncCustomers): só pedidos alterados desde a última.
    const since = updatedSince !== undefined
      ? updatedSince
      : (await this.getActiveConnection(userId, shop)).lastSyncAt;

    const shopifyOrders = await this.getOrders(userId, shop, {
      limit: 250,
      status: 'any',
      all: true,
      updatedSince: since,
    });
    let imported = 0;
    let updated = 0;

    for (const sOrder of shopifyOrders) {
      // Verificar se a venda já foi importada (usando ID da Shopify no canal ou metadata)
      // Como não temos um externalId na Sale, vamos usar canal e data como proxy ou precisaríamos de um campo.
      // Vou assumir que por enquanto buscamos por email e data aproximada ou simplesmente inserimos se não houver duplicata óbvia.
      // Idealmente a Sale deveria ter um externalId.

      const customerEmail = (sOrder.email || sOrder.customer?.email || '').toLowerCase().trim();
      if (!customerEmail) continue;

      // Buscar ou criar contato
      let contact = await this.contactRepository.findOne({ where: { userId, email: customerEmail } });
      const name = [sOrder.customer?.first_name, sOrder.customer?.last_name].filter(Boolean).join(' ') || sOrder.customer?.name || 'Sem Nome';
      const phone = sOrder.customer?.phone || '';

      if (!contact) {
        contact = this.contactRepository.create({
          userId,
          email: customerEmail,
          name,
          phone,
          source: 'shopify',
          status: 'customer',
        });
        await this.contactRepository.save(contact);
      } else {
        // Atualizar dados do contato se estiverem vazios
        let updatedContact = false;
        if (!contact.name || contact.name === 'Sem Nome') {
          contact.name = name;
          updatedContact = true;
        }
        if (!contact.phone && phone) {
          contact.phone = phone;
          updatedContact = true;
        }
        if (updatedContact) {
          await this.contactRepository.save(contact);
        }
      }

      // Processar itens do pedido
      for (let index = 0; index < sOrder.line_items.length; index++) {
        const item = sOrder.line_items[index];
        console.log(`[Shopify Sync] Pedido ${sOrder.name || sOrder.id} - Recebido item:`, { sku: item.sku, name: item.name, title: item.title, price: item.price, quantity: item.quantity });

        const itemName = item.name || item.title;
        const searchConditions: any[] = [];
        if (item.sku) searchConditions.push({ userId, sku: item.sku });
        if (itemName) searchConditions.push({ userId, name: itemName });

        console.log(`[Shopify Sync] Condições de busca para o produto:`, searchConditions);

        let product = searchConditions.length > 0 ? await this.productRepository.findOne({
          where: searchConditions
        }) : null;

        if (!product) {
          console.log(`[Shopify Sync] Produto NÃO encontrado no CRM. Criando novo produto...`);
          // Criar produto básico se não existir
          product = this.productRepository.create({
            userId,
            name: itemName || 'Produto sem nome',
            sku: item.sku || '',
            price: parseFloat(item.price),
            stock: 0,
            active: true,
          });
          await this.productRepository.save(product);
          console.log(`[Shopify Sync] Novo produto criado. ID: ${product.id}, Nome: "${product.name}", SKU: "${product.sku}"`);
        } else {
          console.log(`[Shopify Sync] Produto ENCONTRADO no CRM. ID: ${product.id}, Nome: "${product.name}", SKU: "${product.sku}"`);
        }

        // Criar a venda
        // Evitar duplicidade usando externalId único por item de linha
        const createdAt = new Date(sOrder.created_at);
        const externalId = `shopify_${sOrder.id}_${item.id || item.variant_id || index}`;

        let statusMatch = 'processing';
        if (sOrder.financial_status === 'voided' || sOrder.financial_status === 'refunded' || sOrder.cancelled_at) {
          statusMatch = 'cancelled';
        } else if (sOrder.fulfillment_status === 'fulfilled') {
          statusMatch = 'delivered';
        } else if (sOrder.financial_status === 'paid') {
          statusMatch = 'completed';
        } else if (sOrder.financial_status === 'pending') {
          statusMatch = 'pending';
        }

        const paymentMethod = sOrder.gateway || (sOrder.payment_gateway_names && sOrder.payment_gateway_names.length > 0 ? sOrder.payment_gateway_names[0] : null);

        let existingSale: Sale | null = null;
        try {
          existingSale = await this.saleRepository.findOne({
            where: { userId, externalId }
          });
        } catch (error) {
          console.error(`[Shopify Sync] Erro ao buscar por externalId (${externalId}):`, error.message);
        }

        // Se não achou por externalId, tenta o fallback por data e produto (para vendas migradas/antigas)
        if (!existingSale) {
          let existingSaleConditions: any = {
            userId,
            productId: product.id,
            createdAt: createdAt,
          };
          if (customerEmail) {
            existingSaleConditions.customerEmail = customerEmail;
          }

          existingSale = await this.saleRepository.findOne({
            where: existingSaleConditions
          });

          if (existingSale) {
            console.log(`[Shopify Sync] Venda encontrada via fallback (Produto e Data). ID: ${existingSale.id}`);
          }
        }

        if (existingSale) {
          let needsUpdate = false;

          if (!existingSale.contactId && contact?.id) {
            console.log(`[Shopify Sync] Vinculando Contato ID ${contact.id} à Venda ID ${existingSale.id}`);
            existingSale.contactId = contact.id;
            needsUpdate = true;
          }
          if (!existingSale.externalId) {
            existingSale.externalId = externalId;
            needsUpdate = true;
          }
          if (existingSale.status !== statusMatch) {
            existingSale.status = statusMatch;
            needsUpdate = true;
          }
          if (paymentMethod && !existingSale.paymentMethod) {
            existingSale.paymentMethod = paymentMethod;
            needsUpdate = true;
          }

          if (needsUpdate) {
            await this.saleRepository.save(existingSale);
            console.log(`[Shopify Sync] Venda ID ${existingSale.id} atualizada com sucesso.`);
          }
        }

        if (!existingSale) {
          console.log(`[Shopify Sync] Relacionando Venda ao Produto ID: ${product.id}`);
          const sale = this.saleRepository.create({
            userId,
            productId: product.id,
            contactId: contact?.id,
            quantity: item.quantity,
            unitPrice: parseFloat(item.price),
            totalValue: parseFloat(item.price) * item.quantity,
            customerName: contact ? contact.name : sOrder.customer?.first_name,
            customerEmail: customerEmail,
            channel: 'shopify',
            status: statusMatch,
            paymentMethod: paymentMethod,
            createdAt: createdAt,
            externalId: externalId,
            couponCode: sOrder.discount_codes && sOrder.discount_codes.length > 0 ? sOrder.discount_codes[0].code : null,
          });
          await this.saleRepository.save(sale);
          imported++;
        }
        console.log(`[Shopify Sync] Venda processada: Pedido ${sOrder.name || sOrder.id} - Status: ${statusMatch} - Cliente: ${customerEmail}`);
      }
    }

    const connection = await this.getActiveConnection(userId, shop);
    connection.lastSyncAt = new Date();
    await this.shopifyConnectionRepository.save(connection);

    return { imported, updated };
  }

  /**
   * Sincroniza carrinhos ativos/abandonados da Shopify para o CRM
   */
  async syncCheckouts(userId: number, shop: string): Promise<{ imported: number; updated: number }> {
    const allCheckouts = await this.getAbandonedCheckouts(userId, shop, { limit: 250, all: true });
    let imported = 0;
    let updated = 0;

    const now = new Date();
    const fifteenMinutesAgo = new Date(now.getTime() - (15 * 60 * 1000));
    
    this.logger.log(`[Shopify Sync] Buscando carrinhos criados antes de: ${fifteenMinutesAgo.toISOString()}`);

    for (const checkout of allCheckouts) {
      const createdAt = checkout.created_at ? new Date(checkout.created_at) : new Date();
      
      // Critério: Apenas considerar abandonado se tiver mais de 15 minutos para testes rápidos
      if (createdAt > fifteenMinutesAgo) {
        this.logger.log(`[Shopify Sync] Checkout ${checkout.id} ignorado (muito recente: ${createdAt.toISOString()})`);
        continue;
      }
      this.logger.log(`[Shopify Sync] Processando checkout ${checkout.id} de email ${checkout.email || checkout.customer?.email}`);

      const customerEmail = (checkout.email || checkout.customer?.email || '').toLowerCase().trim();
      if (!customerEmail) continue;

      let contact = await this.contactRepository.findOne({ where: { userId, email: customerEmail } });
      const firstName = checkout.customer?.first_name || checkout.shipping_address?.first_name || checkout.billing_address?.first_name || '';
      const lastName = checkout.customer?.last_name || checkout.shipping_address?.last_name || checkout.billing_address?.last_name || '';
      const name = [firstName, lastName].filter(Boolean).join(' ') || checkout.customer?.name || 'Sem Nome';
      const phone = checkout.customer?.phone || checkout.shipping_address?.phone || checkout.billing_address?.phone || '';

      if (!contact) {
        contact = this.contactRepository.create({
          userId,
          email: customerEmail,
          name,
          phone,
          source: 'shopify',
          status: 'lead',
        });
        await this.contactRepository.save(contact);
      } else {
        // Atualizar dados do contato se estiverem vazios
        let updatedContact = false;
        if (!contact.name || contact.name === 'Sem Nome') {
          contact.name = name;
          updatedContact = true;
        }
        if (!contact.phone && phone) {
          contact.phone = phone;
          updatedContact = true;
        }
        if (updatedContact) {
          await this.contactRepository.save(contact);
        }
      }

      const externalId = checkout.id ? checkout.id.toString() : checkout.token;

      if (!checkout.line_items) continue;

      for (let index = 0; index < checkout.line_items.length; index++) {
        const item = checkout.line_items[index];
        const itemName = item.name || item.title;
        const searchConditions: any[] = [];
        if (item.sku) searchConditions.push({ userId, sku: item.sku });
        if (itemName) searchConditions.push({ userId, name: itemName });

        let product = searchConditions.length > 0 ? await this.productRepository.findOne({
          where: searchConditions
        }) : null;

        if (!product) {
          product = this.productRepository.create({
            userId,
            name: itemName || 'Produto sem nome',
            sku: item.sku || '',
            price: parseFloat(item.price),
            stock: 0,
            active: true,
          });
          await this.productRepository.save(product);
        }

        const checkoutStatus = checkout.status === 'open' ? 'active_cart' : 'abandoned_cart';

        const existingSale = await this.saleRepository.findOne({
          where: { userId, externalId, productId: product.id }
        });

        if (existingSale) {
          let needsUpdate = false;
          if (existingSale.status !== checkoutStatus) {
            existingSale.status = checkoutStatus;
            needsUpdate = true;
          }
          if (needsUpdate) {
            await this.saleRepository.save(existingSale);
            updated++;
          }
        } else {
          const sale = this.saleRepository.create({
            userId,
            productId: product.id,
            contactId: contact?.id,
            quantity: item.quantity,
            unitPrice: parseFloat(item.price),
            totalValue: parseFloat(item.price) * item.quantity,
            customerName: contact ? contact.name : checkout.customer?.first_name,
            customerEmail: customerEmail,
            channel: 'shopify',
            status: checkoutStatus,
            createdAt: createdAt,
            externalId: externalId,
          });
          await this.saleRepository.save(sale);
          imported++;
          console.log(`[Shopify Sync] Novo carrinho importado: ${externalId} - Cliente: ${customerEmail} - Criado em: ${createdAt.toISOString()}`);
        }
      }
    }

    const connection = await this.getActiveConnection(userId, shop);
    connection.lastSyncAt = new Date();
    await this.shopifyConnectionRepository.save(connection);

    return { imported, updated };
  }

  /**
   * Sincroniza produtos da Shopify para o CRM
   */
  async syncProductsToCrm(userId: number, shop: string): Promise<{ imported: number; updated: number }> {
    let allProducts: any[] = [];
    try {
      const accessToken = await this.getAccessToken(userId, shop);
      allProducts = await this.fetchProductsGraphql(shop, accessToken, { all: true });
    } catch (error) {
      this.logger.error(`Erro ao sincronizar produtos da loja ${shop}: ${error.message}`);
    }

    let imported = 0;
    let updated = 0;

    for (const item of allProducts) {
      const price = item.variants && item.variants.length > 0 ? parseFloat(item.variants[0].price) : 0;
      const sku = item.variants && item.variants.length > 0 ? item.variants[0].sku : '';
      const stock = item.variants && item.variants.length > 0 && item.variants[0].inventory_quantity ? item.variants[0].inventory_quantity : 0;
      const name = item.title || 'Produto sem nome';
      const imageSrc = item.images && item.images.length > 0 ? item.images[0].src : null;
      const externalId = item.id.toString();

      // 1. Tentar buscar por ID Externo
      const jsonPath = `$.shopify."${shop}"`;
      let product = await this.productRepository.createQueryBuilder('product')
        .where('product.userId = :userId', { userId })
        .andWhere(`JSON_EXTRACT(product.externalIds, :jsonPath) = :externalId`, { jsonPath, externalId })
        .getOne();

      // 2. Tentar buscar por SKU
      if (!product && sku) {
        product = await this.productRepository.findOne({
          where: { userId, sku }
        });
      }

      // 3. Tentar buscar por Nome (Fallback)
      if (!product) {
        product = await this.productRepository.findOne({
          where: { userId, name }
        });
      }

      if (!product) {
        product = this.productRepository.create({
          userId,
          name: name,
          sku: sku || '',
          price: price,
          stock: stock,
          active: true,
          coverPhoto: imageSrc,
          externalIds: {
            shopify: { [shop]: externalId }
          }
        });
        await this.productRepository.save(product);
        imported++;
      } else {
        // Atualizar ID externo se não estiver presente
        const currentExternalIds = product.externalIds || {};
        const shopifyIds = currentExternalIds.shopify || {};

        if (shopifyIds[shop] !== externalId) {
          product.externalIds = {
            ...currentExternalIds,
            shopify: { ...shopifyIds, [shop]: externalId }
          };
        }

        product.price = price > 0 ? price : product.price;
        product.stock = stock;
        if (imageSrc && !product.coverPhoto) {
          product.coverPhoto = imageSrc;
        }
        await this.productRepository.save(product);
        updated++;
      }
    }

    const connection = await this.getActiveConnection(userId, shop);
    connection.lastSyncAt = new Date();
    await this.shopifyConnectionRepository.save(connection);

    return { imported, updated };
  }
  /**
   * Cria um código de desconto na Shopify via GraphQL
   */
  async createDiscountCode(
    userId: number,
    shop: string,
    params: {
      title: string;
      code: string;
      value: string;
      valueType: 'percentage' | 'fixed';
      endsAt?: string;
      usageLimit?: number;
    }
  ): Promise<any> {
    const accessToken = await this.getAccessToken(userId, shop);

    const mutation = `
      mutation discountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
        discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
          codeDiscountNode {
            codeDiscount {
              ... on DiscountCodeBasic {
                title
                codes(first: 10) {
                  nodes {
                    code
                  }
                }
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const variables = {
      basicCodeDiscount: {
        title: params.title,
        usageLimit: params.usageLimit || 1, // Se não informado, padrão é 1
        appliesOncePerCustomer: true,
        code: params.code,
        startsAt: new Date().toISOString(),
        customerGets: {
          value: params.valueType === 'percentage'
            ? { discountAmount: { amount: parseFloat(params.value), appliesOnEachItem: true } }
            : { discountAmount: { amount: parseFloat(params.value), appliesOnEachItem: false } },
          items: {
            all: true
          }
        },
        customerSelection: {
          all: true
        },
        ...(params.endsAt && { endsAt: params.endsAt })
      }
    };

    // Ajuste para porcentagem no GraphQL (usa percentage: decimal_value)
    if (params.valueType === 'percentage') {
      const percentageDecimal = parseFloat(params.value) / 100;
      variables.basicCodeDiscount.customerGets.value = {
        percentage: percentageDecimal
      } as any;
    }

    const result = await this.makeGraphqlRequest(shop, accessToken, mutation, variables);

    if (result.data?.discountCodeBasicCreate?.userErrors?.length > 0) {
      // Se for duplicado, podemos não lançar erro (apenas ignorar) ou tratar
      const errorMessage = result.data.discountCodeBasicCreate.userErrors[0].message;
      if (!errorMessage.toLowerCase().includes('already taken')) {
        this.logger.warn(`Shopify Erro ao criar cupom: ${errorMessage}`);
        // throw new BadRequestException(`Erro criando cupom Shopify: ${errorMessage}`);
      }
    }

    const codeNode = result.data?.discountCodeBasicCreate?.codeDiscountNode;
    this.logger.log(`Cupom '${params.code}' gerado/validado com sucesso na loja ${shop}. Detalhes: ${JSON.stringify(codeNode)}`);

    return codeNode;
  }

  /**
   * Cria um código de desconto de FRETE GRÁTIS na Shopify via GraphQL
   */
  async createFreeShippingDiscountCode(
    userId: number,
    shop: string,
    params: {
      title: string;
      code: string;
      startsAt?: string;
      endsAt?: string;
      usageLimit?: number;
      appliesOncePerCustomer?: boolean;
      minimumSubtotal?: string;
      maximumShippingPrice?: string;
    }
  ): Promise<any> {
    const accessToken = await this.getAccessToken(userId, shop);

    const mutation = `
      mutation discountCodeFreeShippingCreate($freeShippingCodeDiscount: DiscountCodeFreeShippingInput!) {
        discountCodeFreeShippingCreate(freeShippingCodeDiscount: $freeShippingCodeDiscount) {
          codeDiscountNode {
            codeDiscount {
              ... on DiscountCodeFreeShipping {
                title
                codes(first: 1) {
                  nodes {
                    code
                  }
                }
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const variables = {
      freeShippingCodeDiscount: {
        title: params.title,
        code: params.code,
        startsAt: params.startsAt || new Date().toISOString(),
        ...(params.endsAt && { endsAt: params.endsAt }),
        usageLimit: params.usageLimit || 1,
        appliesOncePerCustomer: params.appliesOncePerCustomer ?? true,
        destinationSelection: {
          all: true
        },
        customerSelection: {
          all: true
        },
        ...(params.minimumSubtotal && {
          minimumRequirement: {
            subtotal: {
              greaterThanOrEqualToSubtotal: params.minimumSubtotal
            }
          }
        }),
        ...(params.maximumShippingPrice && {
          maximumShippingPrice: params.maximumShippingPrice
        })
      }
    };

    const result = await this.makeGraphqlRequest(shop, accessToken, mutation, variables);

    if (result.data?.discountCodeFreeShippingCreate?.userErrors?.length > 0) {
      const errorMessage = result.data.discountCodeFreeShippingCreate.userErrors[0].message;
      this.logger.warn(`Shopify Erro ao criar cupom de frete: ${errorMessage}`);
      throw new BadRequestException(`Erro criando cupom de frete Shopify: ${errorMessage}`);
    }

    const codeNode = result.data?.discountCodeFreeShippingCreate?.codeDiscountNode;
    this.logger.log(`Cupom de Frete '${params.code}' gerado com sucesso na Shopify: ${shop}`);

    return codeNode;
  }

  /**
   * Busca o ID (GraphQL GID) de um cupom pelo código
   */
  async findDiscountCodeIdByCode(userId: number, shop: string, code: string): Promise<string | null> {
    const accessToken = await this.getAccessToken(userId, shop);
    const query = `
      query {
        codeDiscountNodes(first: 1, query: "code:${code}") {
          nodes {
            id
            codeDiscount {
              ... on DiscountCodeBasic {
                id
              }
              ... on DiscountCodeFreeShipping {
                id
              }
            }
          }
        }
      }
    `;

    const result = await this.makeGraphqlRequest(shop, accessToken, query);
    const nodes = result.data?.codeDiscountNodes?.nodes;
    if (nodes && nodes.length > 0) {
      return nodes[0].codeDiscount?.id || nodes[0].id;
    }
    return null;
  }

  /**
   * Atualiza o limite de uso de um cupom básico
   */
  async updateDiscountCodeUsageLimit(userId: number, shop: string, discountId: string, usageLimit: number): Promise<any> {
    const accessToken = await this.getAccessToken(userId, shop);
    const mutation = `
      mutation discountCodeBasicUpdate($id: ID!, $basicCodeDiscount: DiscountCodeBasicInput!) {
        discountCodeBasicUpdate(id: $id, basicCodeDiscount: $basicCodeDiscount) {
          userErrors {
            field
            message
          }
        }
      }
    `;

    const variables = {
      id: discountId,
      basicCodeDiscount: {
        usageLimit
      }
    };

    return await this.makeGraphqlRequest(shop, accessToken, mutation, variables);
  }

  /**
   * Atualiza o limite de uso de um cupom de frete grátis
   */
  async updateFreeShippingUsageLimit(userId: number, shop: string, discountId: string, usageLimit: number): Promise<any> {
    const accessToken = await this.getAccessToken(userId, shop);
    const mutation = `
      mutation discountCodeFreeShippingUpdate($id: ID!, $freeShippingCodeDiscount: DiscountCodeFreeShippingInput!) {
        discountCodeFreeShippingUpdate(id: $id, freeShippingCodeDiscount: $freeShippingCodeDiscount) {
          userErrors {
            field
            message
          }
        }
      }
    `;

    const variables = {
      id: discountId,
      freeShippingCodeDiscount: {
        usageLimit
      }
    };

    return await this.makeGraphqlRequest(shop, accessToken, mutation, variables);
  }

  /**
   * Cria um Gift Card na Shopify via GraphQL
   */
  async createGiftCard(
    userId: number,
    shop: string,
    params: {
      initialValue: string;
      note?: string;
      customerId?: string; // GID from Shopify or numeric
      endsAt?: string;
    }
  ): Promise<{ code: string }> {
    const accessToken = await this.getAccessToken(userId, shop);

    // `giftCardCreate` devolve o código em texto no campo `giftCardCode`
    // (a REST Admin API é legada e apps públicos novos devem usar GraphQL).
    const mutation = `
      mutation GiftCardCreate($input: GiftCardCreateInput!) {
        giftCardCreate(input: $input) {
          giftCardCode
          giftCard { id }
          userErrors { field message }
        }
      }
    `;

    // O customerId pode chegar numérico ou como GID — a mutation exige GID.
    const customerGid = params.customerId
      ? (String(params.customerId).includes('gid://')
          ? String(params.customerId)
          : `gid://shopify/Customer/${this.gidToId(String(params.customerId))}`)
      : undefined;

    const input: any = {
      initialValue: parseFloat(params.initialValue).toFixed(2),
      ...(params.note && { note: params.note }),
      ...(customerGid && { customerId: customerGid }),
      // expiresOn é uma data (YYYY-MM-DD), não datetime.
      ...(params.endsAt && { expiresOn: params.endsAt.split('T')[0] }),
    };

    const result = await this.makeGraphqlRequest(shop, accessToken, mutation, { input });

    const payload = result.data?.giftCardCreate;
    const userErrors = payload?.userErrors || [];
    if (userErrors.length > 0) {
      const msg = userErrors[0].message;
      this.logger.error(`[Shopify GiftCard] userError ao criar gift card em ${shop}: ${msg}`);
      throw new BadRequestException(msg);
    }

    if (!payload?.giftCardCode) {
      this.logger.error(`[Shopify GiftCard] Resposta sem giftCardCode para ${shop}: ${JSON.stringify(result.errors || result)}`);
      throw new BadRequestException('Código do Gift Card não retornado pela Shopify.');
    }

    return { code: payload.giftCardCode };
  }

  /**
   * Registra o webhook e informa se ele JÁ foi processado antes.
   *
   * A unicidade de `webhookId` no banco é o que garante o dedupe sob corrida
   * (duas entregas simultâneas do mesmo evento): a segunda inserção falha.
   * Retorna true quando o evento é novo e deve ser processado.
   */
  async registerWebhookEvent(webhookId: string, topic: string, shop: string): Promise<boolean> {
    // Sem o header não há como deduplicar — processa (melhor que descartar).
    if (!webhookId) return true;

    try {
      await this.webhookEventRepository.insert({ webhookId, topic, shop });
      return true;
    } catch (error: any) {
      if (error?.code === 'ER_DUP_ENTRY' || error?.driverError?.code === 'ER_DUP_ENTRY') {
        this.logger.log(`[Shopify Webhook] Evento ${webhookId} (${topic}) já processado; ignorando reentrega.`);
        return false;
      }
      // Falha de infraestrutura no dedupe não deve derrubar o webhook.
      this.logger.error(`[Shopify Webhook] Erro ao registrar evento ${webhookId}: ${error.message}`);
      return true;
    }
  }

  /**
   * Remove registros de dedupe antigos (a Shopify só retenta por ~48h).
   */
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async purgeOldWebhookEvents(): Promise<void> {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const result = await this.webhookEventRepository.delete({ createdAt: LessThan(cutoff) });
    if (result.affected) {
      this.logger.log(`[Shopify Webhook] Purge de dedupe: ${result.affected} evento(s) antigo(s) removido(s).`);
    }
  }

  /**
   * Processa webhooks da Shopify (carrinhos e checkouts)
   */
  async handleWebhook(topic: string, shop: string, data: any): Promise<void> {
    this.logger.log(`[Shopify Webhook] Processando tópico ${topic} para loja ${shop}`);

    // app/uninstalled não depende de conexão ativa e deve rodar sempre.
    if (topic === 'app/uninstalled') {
      await this.handleAppUninstalled(shop);
      return;
    }

    // Buscar todas as conexões para esta loja (pode haver múltiplos usuários com a mesma loja conectada)
    const connections = await this.shopifyConnectionRepository.find({
      where: { shop, isActive: true }
    });

    if (connections.length === 0) {
      this.logger.warn(`[Shopify Webhook] Nenhuma conexão ativa encontrada para a loja ${shop}`);
      return;
    }

    const failures: string[] = [];

    for (const connection of connections) {
      const userId = connection.userId;

      try {
        if (topic.startsWith('carts/') || topic.startsWith('checkouts/')) {
          await this.processCartWebhook(userId, topic, data);
        } else if (topic.startsWith('orders/') || topic === 'refunds/create') {
          await this.processOrderWebhook(userId, topic, data);
        }
      } catch (error) {
        this.logger.error(`[Shopify Webhook] Erro ao processar webhook para usuário ${userId}:`, error.message);
        failures.push(`userId ${userId}: ${error.message}`);
      }
    }

    // Falha real precisa virar erro HTTP para a Shopify reentregar o evento.
    // Engolir o erro e responder 200 perdia o pedido silenciosamente.
    if (failures.length > 0) {
      throw new Error(`Falha ao processar ${topic} de ${shop} — ${failures.join('; ')}`);
    }
  }

  /**
   * Remove o registro de dedupe de um evento (usado quando o processamento
   * falhou e queremos que a reentrega da Shopify seja processada de novo).
   */
  async unregisterWebhookEvent(webhookId: string): Promise<void> {
    if (!webhookId) return;
    await this.webhookEventRepository.delete({ webhookId }).catch(() => undefined);
  }

  /**
   * Processa webhooks de carrinho/checkout
   */
  private async processCartWebhook(userId: number, topic: string, data: any): Promise<void> {
    const customerEmail = data.email || data.customer?.email;
    if (!customerEmail) return;

    // Buscar ou criar contato
    let contact = await this.contactRepository.findOne({ where: { userId, email: customerEmail } });
    if (!contact) {
      contact = this.contactRepository.create({
        userId,
        email: customerEmail,
        name: [data.customer?.first_name || data.shipping_address?.first_name, data.customer?.last_name || data.shipping_address?.last_name].filter(Boolean).join(' ') || 'Sem Nome',
        source: 'shopify',
        status: 'customer',
      });
      await this.contactRepository.save(contact);
    }

    const items = data.line_items || [];
    const externalId = data.id ? data.id.toString() : data.token;
    // `completed_at` significa que o checkout VIROU PEDIDO — recuperado, nunca
    // abandonado. Só o tópico de abandono classifica como carrinho abandonado.
    let checkoutStatus: string;
    if (data.completed_at) {
      checkoutStatus = 'recovered_cart';
    } else if (topic.includes('abandoned')) {
      checkoutStatus = 'abandoned_cart';
    } else {
      checkoutStatus = 'active_cart';
    }

    for (const item of items) {
      const itemName = item.name || item.title;
      const searchConditions: any[] = [];
      if (item.sku) searchConditions.push({ userId, sku: item.sku });
      if (itemName) searchConditions.push({ userId, name: itemName });

      let product = searchConditions.length > 0 ? await this.productRepository.findOne({
        where: searchConditions
      }) : null;

      if (!product) {
        product = this.productRepository.create({
          userId,
          name: itemName || 'Produto sem nome',
          sku: item.sku || '',
          price: parseFloat(item.price || '0'),
          stock: 0,
          active: true,
        });
        await this.productRepository.save(product);
      }

      const existingSale = await this.saleRepository.findOne({
        where: { userId, externalId, productId: product.id }
      });

      if (existingSale) {
        if (existingSale.status !== checkoutStatus) {
          existingSale.status = checkoutStatus;
          await this.saleRepository.save(existingSale);
        }
      } else {
        const sale = this.saleRepository.create({
          userId,
          productId: product.id,
          contactId: contact.id,
          quantity: item.quantity,
          unitPrice: parseFloat(item.price || '0'),
          totalValue: parseFloat(item.price || '0') * item.quantity,
          customerName: contact.name,
          customerEmail: customerEmail,
          channel: 'shopify',
          status: checkoutStatus,
          createdAt: new Date(),
          externalId: externalId,
        });
        await this.saleRepository.save(sale);
      }
    }
  }

  /**
   * Mapeia o estado do pedido na Shopify para o status de venda do CRM.
   * Ordem importa: cancelamento/estorno vence fulfillment, que vence pagamento.
   */
  private mapOrderStatus(order: any): string {
    const financial = String(order.financial_status || '').toLowerCase();
    const fulfillment = String(order.fulfillment_status || '').toLowerCase();

    if (order.cancelled_at || financial === 'voided' || financial === 'refunded') {
      return 'cancelled';
    }
    if (fulfillment === 'fulfilled') return 'delivered';
    if (financial === 'paid' || financial === 'partially_refunded') return 'completed';
    if (financial === 'pending' || financial === 'authorized') return 'pending';
    return 'processing';
  }

  /**
   * Valor líquido de um item: preço já com descontos × quantidade ATUAL
   * (quantidade atual desconta itens removidos por edição/reembolso parcial).
   */
  private lineItemNetTotal(item: any): number {
    const unit = parseFloat(item.price ?? item.original_price ?? '0') || 0;
    const qty = Number(item.quantity ?? item.original_quantity ?? 0) || 0;
    return unit * qty;
  }

  /**
   * Processa webhooks de pedidos em tempo real (orders/*, refunds/create).
   *
   * Faz upsert das vendas por `externalId` (um registro por linha do pedido),
   * usando valores líquidos e quantidades atuais, e marca o checkout de origem
   * como recuperado quando o pedido veio de um carrinho abandonado.
   */
  private async processOrderWebhook(userId: number, topic: string, data: any): Promise<void> {
    // refunds/create traz o reembolso, não o pedido: o pedido vem em order_id.
    const order = topic === 'refunds/create' ? data.order || data : data;
    const orderId = order?.id ?? data?.order_id;
    if (!orderId) {
      this.logger.warn(`[Shopify Webhook] ${topic} sem id de pedido; ignorado.`);
      return;
    }

    // Em refunds/create o payload do reembolso não descreve o pedido inteiro.
    // Buscar o estado atual do pedido garante status e valores corretos.
    let fullOrder = order;
    if (topic === 'refunds/create' || !order.line_items) {
      const fetched = await this.fetchOrderById(userId, orderId).catch((e) => {
        this.logger.error(`[Shopify Webhook] Falha ao buscar pedido ${orderId}: ${e.message}`);
        return null;
      });
      if (!fetched) return;
      fullOrder = fetched;
    }

    const customerEmail = (fullOrder.email || fullOrder.customer?.email || '').toLowerCase().trim();
    const customerPhone = fullOrder.customer?.phone || fullOrder.phone || '';
    const customerName =
      [fullOrder.customer?.first_name, fullOrder.customer?.last_name].filter(Boolean).join(' ') ||
      fullOrder.customer?.name ||
      'Sem Nome';

    // Contato: casar por externalId (sobrevive a troca de e-mail) e depois por e-mail.
    const shopifyCustomerId = fullOrder.customer?.id ? String(fullOrder.customer.id) : null;
    let contact: Contact | null = null;
    if (shopifyCustomerId) {
      contact = await this.contactRepository.findOne({ where: { userId, externalId: shopifyCustomerId } });
    }
    if (!contact && customerEmail) {
      contact = await this.contactRepository.findOne({ where: { userId, email: customerEmail } });
    }

    if (!contact && (customerEmail || customerPhone)) {
      contact = this.contactRepository.create({
        userId,
        email: customerEmail || null,
        phone: customerPhone || null,
        name: customerName,
        source: 'shopify',
        status: 'customer',
        externalId: shopifyCustomerId,
      });
      contact = await this.contactRepository.save(contact);
    } else if (contact) {
      let dirty = false;
      if (!contact.externalId && shopifyCustomerId) { contact.externalId = shopifyCustomerId; dirty = true; }
      if ((!contact.name || contact.name === 'Sem Nome') && customerName !== 'Sem Nome') { contact.name = customerName; dirty = true; }
      if (!contact.phone && customerPhone) { contact.phone = customerPhone; dirty = true; }
      // Pedido confirma que o lead virou cliente.
      if (contact.status === 'lead') { contact.status = 'customer'; dirty = true; }
      if (dirty) await this.contactRepository.save(contact);
    }

    const status = this.mapOrderStatus(fullOrder);
    const createdAt = fullOrder.created_at ? new Date(fullOrder.created_at) : new Date();
    const paymentMethod =
      fullOrder.gateway ||
      (fullOrder.payment_gateway_names?.length ? fullOrder.payment_gateway_names[0] : null);
    const couponCode = fullOrder.discount_codes?.length ? fullOrder.discount_codes[0].code : null;

    const items = fullOrder.line_items || [];
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      const externalId = `shopify_${orderId}_${item.id || item.variant_id || index}`;

      const product = await this.findOrCreateProductForItem(userId, item);
      const quantity = Number(item.quantity ?? item.original_quantity ?? 0) || 0;
      const unitPrice = parseFloat(item.price ?? '0') || 0;
      const totalValue = this.lineItemNetTotal(item);

      const existing = await this.saleRepository.findOne({ where: { userId, externalId } });

      if (existing) {
        existing.status = status;
        existing.quantity = quantity;
        existing.unitPrice = unitPrice;
        existing.totalValue = totalValue;
        if (contact?.id && !existing.contactId) existing.contactId = contact.id;
        if (paymentMethod && !existing.paymentMethod) existing.paymentMethod = paymentMethod;
        await this.saleRepository.save(existing);
      } else {
        // Item totalmente removido/estornado e ainda não registrado: nada a criar.
        if (quantity <= 0) continue;
        const sale = this.saleRepository.create({
          userId,
          productId: product.id,
          contactId: contact?.id,
          quantity,
          unitPrice,
          totalValue,
          customerName: contact?.name || customerName,
          customerEmail: customerEmail || null,
          channel: 'shopify',
          status,
          paymentMethod,
          createdAt,
          externalId,
          couponCode,
        });
        await this.saleRepository.save(sale);
      }
    }

    // Checkout que virou pedido: marcar como recuperado para sair da régua de
    // carrinho abandonado (evita disparar campanha para quem já comprou).
    const checkoutToken = fullOrder.checkout_token || fullOrder.checkout_id;
    if (checkoutToken) {
      await this.markCheckoutRecovered(userId, String(checkoutToken));
    }

    this.logger.log(`[Shopify Webhook] Pedido ${orderId} processado (${topic}) para userId ${userId} — status ${status}, ${items.length} item(ns).`);
  }

  /**
   * Marca as vendas de um checkout como recuperadas (o carrinho virou pedido).
   */
  private async markCheckoutRecovered(userId: number, checkoutExternalId: string): Promise<void> {
    const result = await this.saleRepository.update(
      { userId, externalId: checkoutExternalId, status: 'abandoned_cart' },
      { status: 'recovered_cart' },
    );
    if (result.affected) {
      this.logger.log(`[Shopify Webhook] Checkout ${checkoutExternalId} marcado como recuperado (${result.affected} registro(s)).`);
    }
  }

  /**
   * Busca um pedido específico na Admin API (usado quando o webhook não traz o
   * pedido completo, como em refunds/create).
   */
  private async fetchOrderById(userId: number, orderId: string | number): Promise<any | null> {
    const connection = await this.getActiveConnection(userId);
    const accessToken = await this.getAccessToken(userId, connection.shop);
    const gid = String(orderId).includes('gid://')
      ? String(orderId)
      : `gid://shopify/Order/${orderId}`;

    const query = `
      query Order($id: ID!) {
        order(id: $id) {
          id
          name
          email
          phone
          createdAt
          cancelledAt
          displayFinancialStatus
          displayFulfillmentStatus
          paymentGatewayNames
          discountCodes
          currencyCode
          currentTotalPriceSet { shopMoney { amount } }
          customer { id email firstName lastName phone }
          lineItems(first: 100) {
            pageInfo { hasNextPage endCursor }
            nodes { ${this.ORDER_LINE_ITEM_FIELDS} }
          }
        }
      }`;

    const result = await this.makeGraphqlRequest(connection.shop, accessToken, query, { id: gid });
    const o = result.data?.order;
    if (!o) return null;

    const lineItems = (o.lineItems?.nodes || []).map((li: any) => this.mapOrderLineItem(li));
    if (o.lineItems?.pageInfo?.hasNextPage) {
      lineItems.push(
        ...(await this.fetchRemainingLineItems(connection.shop, accessToken, o.id, o.lineItems.pageInfo.endCursor)),
      );
    }

    const orderCustomer = this.mapCustomerContact(o.customer);
    const first = o.customer?.firstName || '';
    const last = o.customer?.lastName || '';
    return {
      id: this.gidToId(o.id),
      name: o.name,
      email: o.email,
      phone: o.phone,
      created_at: o.createdAt,
      cancelled_at: o.cancelledAt,
      financial_status: o.displayFinancialStatus ? String(o.displayFinancialStatus).toLowerCase() : null,
      fulfillment_status: o.displayFulfillmentStatus ? String(o.displayFulfillmentStatus).toLowerCase() : null,
      gateway: (o.paymentGatewayNames || [])[0] || null,
      payment_gateway_names: o.paymentGatewayNames || [],
      discount_codes: (o.discountCodes || []).map((c: string) => ({ code: c })),
      currency: o.currencyCode || null,
      current_total_price: o.currentTotalPriceSet?.shopMoney?.amount ?? null,
      customer: o.customer
        ? {
            id: this.gidToId(o.customer.id),
            email: orderCustomer.email,
            first_name: first,
            last_name: last,
            name: [first, last].filter(Boolean).join(' '),
            phone: orderCustomer.phone,
          }
        : null,
      line_items: lineItems,
    };
  }

  /**
   * Resolve (ou cria) o produto do CRM correspondente a um item de pedido.
   */
  private async findOrCreateProductForItem(userId: number, item: any): Promise<Product> {
    const itemName = item.name || item.title;
    const searchConditions: any[] = [];
    if (item.sku) searchConditions.push({ userId, sku: item.sku });
    if (itemName) searchConditions.push({ userId, name: itemName });

    let product = searchConditions.length > 0
      ? await this.productRepository.findOne({ where: searchConditions })
      : null;

    if (!product) {
      product = this.productRepository.create({
        userId,
        name: itemName || 'Produto sem nome',
        sku: item.sku || '',
        price: parseFloat(item.original_price ?? item.price ?? '0') || 0,
        stock: 0,
        active: true,
      });
      product = await this.productRepository.save(product);
    }

    return product;
  }

  /**
   * Sincroniza todos os dados da Shopify (Clientes, Pedidos, Checkouts e Produtos)
   */
  async syncAll(userId: number, shop?: string): Promise<any> {
    const connection = await this.getActiveConnection(userId, shop);
    const resolvedShop = connection.shop;

    // Marca capturada UMA vez: cada sync atualiza lastSyncAt ao terminar, então
    // ler a conexão dentro de cada um faria os seguintes pularem tudo.
    const since = connection.lastSyncAt;

    const customers = await this.syncCustomers(userId, resolvedShop, since);
    const orders = await this.syncOrders(userId, resolvedShop, since);
    const checkouts = await this.syncCheckouts(userId, resolvedShop);
    const products = await this.syncProductsToCrm(userId, resolvedShop);

    return {
      customers,
      orders,
      checkouts,
      products,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Chamada GraphQL com tratamento de rate limit.
   *
   * A Shopify sinaliza throttling de duas formas: HTTP 429 e — o caso silencioso —
   * HTTP 200 com `errors[].extensions.code === 'THROTTLED'`. Sem tratar o segundo,
   * a sincronização "termina" com resultado vazio como se a loja não tivesse dados.
   * Backoff exponencial, respeitando o custo informado pela API quando disponível.
   */
  private async makeGraphqlRequest(shop: string, accessToken: string, query: string, variables?: any): Promise<any> {
    const url = `https://${shop}/admin/api/${this.apiVersion}/graphql.json`;
    const maxAttempts = 5;

    this.logger.log(`[Shopify GraphQL Request] POST ${url}`);
    this.logger.debug(`[Shopify GraphQL Query] ${query.substring(0, 500)}${query.length > 500 ? '...' : ''}`);
    if (variables) {
      this.logger.debug(`[Shopify GraphQL Variables] ${JSON.stringify(variables)}`);
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': accessToken,
        },
        body: JSON.stringify({ query, variables }),
      });

      // 429: rate limit explícito (respeitar Retry-After quando enviado).
      if (response.status === 429) {
        if (attempt === maxAttempts) {
          throw new BadRequestException('Rate limit da Shopify excedido (429) após múltiplas tentativas');
        }
        const retryAfter = Number(response.headers.get('retry-after')) || 0;
        const waitMs = retryAfter > 0 ? retryAfter * 1000 : Math.min(1000 * 2 ** (attempt - 1), 8000);
        this.logger.warn(`[Shopify GraphQL] HTTP 429 para ${shop}. Aguardando ${waitMs}ms (tentativa ${attempt}/${maxAttempts}).`);
        await this.sleep(waitMs);
        continue;
      }

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`[Shopify GraphQL Error] Status: ${response.status}`, errorText);
        throw new BadRequestException(`Falha na API da Shopify: ${response.status}`);
      }

      const data = await response.json();

      // HTTP 200 + THROTTLED: erro de custo, não de transporte.
      const throttled = (data?.errors || []).some(
        (e: any) => e?.extensions?.code === 'THROTTLED',
      );
      if (throttled) {
        if (attempt === maxAttempts) {
          throw new BadRequestException('Consultas da Shopify throttled após múltiplas tentativas');
        }
        const throttleStatus = data?.extensions?.cost?.throttleStatus;
        const requested = data?.extensions?.cost?.requestedQueryCost || 0;
        let waitMs = Math.min(1000 * 2 ** (attempt - 1), 8000);
        if (throttleStatus?.restoreRate > 0 && requested > throttleStatus.currentlyAvailable) {
          const deficit = requested - throttleStatus.currentlyAvailable;
          waitMs = Math.min(Math.ceil((deficit / throttleStatus.restoreRate) * 1000) + 250, 10000);
        }
        this.logger.warn(`[Shopify GraphQL] THROTTLED para ${shop}. Aguardando ${waitMs}ms (tentativa ${attempt}/${maxAttempts}).`);
        await this.sleep(waitMs);
        continue;
      }

      this.logger.debug(`[Shopify GraphQL Response] ${JSON.stringify(data).substring(0, 1000)}${JSON.stringify(data).length > 1000 ? '...' : ''}`);
      return data;
    }

    throw new BadRequestException('Falha na API da Shopify após múltiplas tentativas');
  }

  // A REST Admin API é legada e não é mais usada por este módulo: todas as
  // chamadas passam por makeGraphqlRequest (que trata rate limit/THROTTLED).

  /**
   * ─────────────────────────────────────────────────────────────────────────
   * SHOPIFY BILLING API (appSubscriptionCreate)
   * ─────────────────────────────────────────────────────────────────────────
   */

  /**
   * A loja é uma development store de parceiro (loja de teste)?
   *
   * Em caso de falha na consulta, trata como loja REAL: é melhor uma cobrança de
   * dev store falhar de forma visível do que um merchant real receber uma
   * cobrança de teste e usar o app de graça.
   */
  async isDevelopmentStore(shop: string, accessToken: string): Promise<boolean> {
    try {
      const result = await this.makeGraphqlRequest(
        shop,
        accessToken,
        `{ shop { plan { partnerDevelopment } } }`,
      );
      return result.data?.shop?.plan?.partnerDevelopment === true;
    } catch (error) {
      this.logger.warn(
        `[Shopify Billing] Não foi possível verificar se ${shop} é development store (${error.message}). Tratando como loja real.`,
      );
      return false;
    }
  }

  /**
   * Cria uma nova assinatura via Shopify Billing API.
   * Retorna a confirmationUrl para redirecionar o merchant.
   */
  async createAppSubscription(
    shop: string,
    accessToken: string,
    plan: { name: string; price: number; interval: string; currencyCode?: string },
    returnUrl: string,
    trialDays: number = 0,
  ): Promise<{ confirmationUrl: string; appSubscriptionId: string }> {
    // Cobrança de teste é decidida POR LOJA: development stores sempre recebem
    // cobrança de teste, lojas reais nunca. A env SHOPIFY_BILLING_TEST_MODE força
    // teste para TODAS as lojas — só faz sentido em staging, nunca em produção.
    const forcedTestMode = this.configService.get<string>('SHOPIFY_BILLING_TEST_MODE') === 'true';
    if (forcedTestMode && process.env.NODE_ENV === 'production') {
      this.logger.warn('[Shopify Billing] SHOPIFY_BILLING_TEST_MODE=true em produção: TODAS as cobranças serão de teste, inclusive de merchants reais.');
    }
    const isTestMode = forcedTestMode || (await this.isDevelopmentStore(shop, accessToken));
    const shopifyInterval = plan.interval === 'yearly' ? 'ANNUAL' : 'EVERY_30_DAYS';
    const currencyCode = plan.currencyCode || 'USD';

    this.logger.log(`[Shopify Billing] Criando assinatura para loja ${shop} — Plano: "${plan.name}", Preço: ${plan.price} ${currencyCode}, Intervalo: ${shopifyInterval}, TestMode: ${isTestMode}`);

    const mutation = `
      mutation AppSubscriptionCreate(
        $name: String!,
        $lineItems: [AppSubscriptionLineItemInput!]!,
        $returnUrl: URL!,
        $test: Boolean,
        $trialDays: Int
      ) {
        appSubscriptionCreate(
          name: $name,
          returnUrl: $returnUrl,
          lineItems: $lineItems,
          test: $test,
          trialDays: $trialDays
        ) {
          userErrors {
            field
            message
          }
          appSubscription {
            id
            status
          }
          confirmationUrl
        }
      }
    `;

    const variables = {
      name: plan.name,
      returnUrl,
      test: isTestMode,
      trialDays: trialDays > 0 ? trialDays : null,
      lineItems: [
        {
          plan: {
            appRecurringPricingDetails: {
              price: {
                amount: Number(plan.price),
                currencyCode,
              },
              interval: shopifyInterval,
            },
          },
        },
      ],
    };

    const response = await fetch(
      `https://${shop}/admin/api/${this.apiVersion}/graphql.json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': accessToken,
        },
        body: JSON.stringify({ query: mutation, variables }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error(`[Shopify Billing] Erro HTTP ${response.status} ao criar assinatura para ${shop}: ${errorText}`);
      throw new BadRequestException(`Falha ao criar assinatura Shopify (HTTP ${response.status})`);
    }

    const result = await response.json();

    if (result.errors?.length > 0) {
      const msg = result.errors[0].message;
      this.logger.error(`[Shopify Billing] Erro GraphQL ao criar assinatura para ${shop}: ${msg}`);
      throw new BadRequestException(msg);
    }

    const { userErrors, appSubscription, confirmationUrl } = result.data.appSubscriptionCreate;

    if (userErrors?.length > 0) {
      const msg = userErrors[0].message;
      this.logger.error(`[Shopify Billing] userError ao criar assinatura para ${shop}: ${msg}`);
      throw new BadRequestException(msg);
    }

    this.logger.log(`[Shopify Billing] Assinatura criada com sucesso para ${shop}. ID: ${appSubscription.id}`);

    return {
      confirmationUrl,
      appSubscriptionId: appSubscription.id,
    };
  }

  /**
   * Consulta o status de uma AppSubscription via GraphQL Admin API.
   */
  async getAppSubscriptionStatus(
    shop: string,
    accessToken: string,
    appSubscriptionId: string,
  ): Promise<{
    id: string;
    status: string;
    name: string;
    test: boolean;
    currentPeriodEnd: string | null;
  }> {
    this.logger.log(`[Shopify Billing] Verificando status da assinatura ${appSubscriptionId} para loja ${shop}`);

    const query = `
      query GetAppSubscription($id: ID!) {
        node(id: $id) {
          ... on AppSubscription {
            id
            name
            status
            test
            currentPeriodEnd
            lineItems {
              id
              plan {
                pricingDetails {
                  ... on AppRecurringPricing {
                    interval
                    price {
                      amount
                      currencyCode
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    const response = await fetch(
      `https://${shop}/admin/api/${this.apiVersion}/graphql.json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': accessToken,
        },
        body: JSON.stringify({ query, variables: { id: appSubscriptionId } }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error(`[Shopify Billing] Erro HTTP ${response.status} ao verificar assinatura ${appSubscriptionId}: ${errorText}`);
      throw new BadRequestException(`Falha ao verificar assinatura Shopify (HTTP ${response.status})`);
    }

    const result = await response.json();

    if (result.errors?.length > 0) {
      throw new BadRequestException(result.errors[0].message);
    }

    const sub = result.data?.node;
    if (!sub) {
      throw new NotFoundException(`AppSubscription ${appSubscriptionId} não encontrada para a loja ${shop}`);
    }

    this.logger.log(`[Shopify Billing] Status da assinatura ${appSubscriptionId}: ${sub.status}`);

    return {
      id: sub.id,
      status: sub.status,
      name: sub.name,
      test: sub.test,
      currentPeriodEnd: sub.currentPeriodEnd ?? null,
    };
  }

  /**
   * Cancela uma AppSubscription via Shopify Billing API.
   */
  async cancelAppSubscription(
    shop: string,
    accessToken: string,
    appSubscriptionId: string,
  ): Promise<{ id: string; status: string }> {
    this.logger.log(`[Shopify Billing] Cancelando assinatura ${appSubscriptionId} para loja ${shop}`);

    const mutation = `
      mutation AppSubscriptionCancel($id: ID!) {
        appSubscriptionCancel(id: $id) {
          userErrors {
            field
            message
          }
          appSubscription {
            id
            status
          }
        }
      }
    `;

    const response = await fetch(
      `https://${shop}/admin/api/${this.apiVersion}/graphql.json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': accessToken,
        },
        body: JSON.stringify({ query: mutation, variables: { id: appSubscriptionId } }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error(`[Shopify Billing] Erro HTTP ${response.status} ao cancelar assinatura ${appSubscriptionId}: ${errorText}`);
      throw new BadRequestException(`Falha ao cancelar assinatura Shopify (HTTP ${response.status})`);
    }

    const result = await response.json();

    if (result.errors?.length > 0) {
      throw new BadRequestException(result.errors[0].message);
    }

    const { userErrors, appSubscription } = result.data.appSubscriptionCancel;

    if (userErrors?.length > 0) {
      throw new BadRequestException(userErrors[0].message);
    }

    this.logger.log(`[Shopify Billing] Assinatura ${appSubscriptionId} cancelada. Novo status: ${appSubscription.status}`);

    return { id: appSubscription.id, status: appSubscription.status };
  }
}

