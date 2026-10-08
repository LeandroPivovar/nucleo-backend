import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  Headers,
  Req,
  Res,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import { ShopifyService } from './shopify.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateShopifyConnectionDto } from './dto/create-shopify-connection.dto';
import { SyncProductsDto } from './dto/sync-products.dto';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Plan } from '../entities/plan.entity';
import { Subscription } from '../entities/subscription.entity';
import { User } from '../entities/user.entity';

@Controller('shopify')
export class ShopifyController {
  constructor(
    private readonly shopifyService: ShopifyService,
    private readonly jwtService: JwtService,
    @InjectRepository(Plan)
    private readonly planRepository: Repository<Plan>,
    @InjectRepository(Subscription)
    private readonly subscriptionRepository: Repository<Subscription>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) { }

  /**
   * Retorna um HTML que força o redirecionamento da janela principal (top-level)
   * saindo do iframe da Shopify. Possui um botão de fallback com target="_top" caso
   * o navegador bloqueie o redirecionamento automático por falta de "user gesture".
   */
  private getBreakoutHtml(redirectUrl: string): string {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Redirecionando...</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
      background-color: #f6f6f7;
      color: #303030;
      text-align: center;
      padding: 20px;
    }
    .card {
      background: white;
      padding: 40px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.05);
      max-width: 400px;
      width: 100%;
    }
    h2 {
      margin-top: 0;
      font-size: 20px;
      color: #202223;
    }
    p {
      color: #6d7175;
      font-size: 14px;
      margin-bottom: 24px;
      line-height: 1.5;
    }
    .btn {
      display: inline-block;
      background-color: #008060;
      color: white;
      text-decoration: none;
      padding: 12px 24px;
      border-radius: 4px;
      font-weight: 500;
      font-size: 14px;
      transition: background-color 0.2s;
    }
    .btn:hover {
      background-color: #006e52;
    }
  </style>
</head>
<body>
  <div class="card">
    <h2>Conexão Shopify concluída!</h2>
    <p>Clique no botão abaixo para retornar de forma segura para o Núcleo CRM e continuar.</p>
    <a href="${redirectUrl}" target="_top" class="btn">Retornar ao Núcleo CRM</a>
  </div>
  <script>
    try {
      window.top.location.href = "${redirectUrl}";
    } catch (e) {
      console.warn("Redirecionamento automático bloqueado pelo navegador devido a políticas de segurança de iframe. Aguardando ação do usuário.", e);
    }
  </script>
</body>
</html>
    `;
  }

  /**
   * Inicia o fluxo OAuth - retorna a URL de autorização
   */
  @Post('auth/init')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async initAuth(
    @Request() req,
    @Body() createShopifyConnectionDto: CreateShopifyConnectionDto,
  ) {
    // Aceita URL pública/domínio próprio, mas converte para o domínio permanente
    // *.myshopify.com antes de assinar o state e iniciar o OAuth.
    const shop = await this.shopifyService.resolveShopDomain(createShopifyConnectionDto.shop);

    // Isolamento: bloqueia se a conta já usa Asaas ou já tem outra loja conectada.
    await this.shopifyService.assertCanConnectShopify(req.user.userId, shop);

    // State assinado (anti-CSRF, vinculado à loja e com validade).
    const state = this.shopifyService.generateSignedState(shop);

    // URL de callback (ajustar conforme necessário)
    const redirectUri = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/integrations/shopify/callback`;

    const authUrl = this.shopifyService.generateAuthUrl(
      shop,
      redirectUri,
      state,
    );

    return {
      authUrl,
      state,
      shop,
    };
  }

  /**
   * Endpoint de instalação direta (Redirecionamento 302)
   * Usado para instalação via App Store ou URL direta
   */
  @Get('auth/install')
  async install(
    @Query('shop') shop: string,
    @Query() query: Record<string, any>,
    @Res() res: ExpressResponse,
  ) {
    this.shopifyService['logger'].log(`[Shopify Controller] Iniciando instalação para loja: ${shop}`);

    // Segurança: só aceitar domínios *.myshopify.com legítimos.
    if (!shop || !this.shopifyService.validateShopDomain(shop)) {
      return res.status(HttpStatus.BAD_REQUEST).send('Parâmetro shop inválido');
    }

    // Se a Shopify assinou a request (hmac presente), validar antes de prosseguir.
    if (query.hmac && !this.shopifyService.verifyOAuthHmac(query)) {
      this.shopifyService['logger'].error(`[Shopify Install] HMAC inválido para loja ${shop}`);
      return res.status(HttpStatus.UNAUTHORIZED).send('Assinatura inválida');
    }

    const connection = await this.shopifyService.findActiveConnectionByShop(shop);
    if (connection) {
      // Já está conectada. Redirecionar para a página de integrações no frontend de forma segura.
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      const redirectUrl = `${frontendUrl}/integracoes?shop=${shop}`;

      res.setHeader('Content-Type', 'text/html');
      return res.send(this.getBreakoutHtml(redirectUrl));
    }

    const state = this.shopifyService.generateSignedState(shop);
    const redirectUri = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/integrations/shopify/callback`;
    const authUrl = this.shopifyService.generateAuthUrl(shop, redirectUri, state);

    return res.redirect(authUrl);
  }

  /**
   * Callback OAuth - recebe o código e troca por token
   * Nota: Este endpoint requer autenticação, mas o frontend já está autenticado
   */
  @Get('auth/callback')
  @HttpCode(HttpStatus.OK)
  async callback(
    @Request() req,
    @Query('code') code: string,
    @Query('shop') shop: string,
    @Query('state') state: string,
    @Query() query: Record<string, any>,
  ) {
    this.shopifyService['logger'].log(`[Shopify Controller] Callback recebido para loja: ${shop}`);
    if (!code || !shop) {
      throw new BadRequestException('Código de autorização ou loja não fornecidos');
    }

    // Segurança: domínio da loja precisa ser um *.myshopify.com legítimo.
    if (!this.shopifyService.validateShopDomain(shop)) {
      throw new BadRequestException('Domínio de loja inválido');
    }

    // Segurança: validar o state assinado (anti-CSRF, vinculado à loja e com validade).
    if (!this.shopifyService.verifySignedState(state, shop)) {
      this.shopifyService['logger'].error(`[Shopify Callback] State inválido para loja ${shop}`);
      throw new UnauthorizedException('State de segurança inválido ou expirado');
    }

    // Segurança: HMAC OBRIGATÓRIO. A Shopify sempre assina o redirect do OAuth;
    // ausência de hmac significa request forjada.
    if (!query.hmac || !this.shopifyService.verifyOAuthHmac(query)) {
      this.shopifyService['logger'].error(`[Shopify Callback] HMAC ausente ou inválido para loja ${shop}`);
      throw new UnauthorizedException('Assinatura inválida');
    }

    // 1. Trocar código por token
    const tokenData = await this.shopifyService.exchangeCodeForToken(
      shop,
      code,
    );

    // NÃO logar tokenData: contém access_token em texto claro.

    // 2. Buscar informações da loja para identificar o usuário
    const shopInfo = await this.shopifyService.getShopInfo(shop, tokenData.access_token);

    // 3. Buscar ou criar o usuário CRM baseado no e-mail da loja
    const user = await this.shopifyService.findOrCreateUserFromShopify(shopInfo, shop);

    // Isolamento: conta existente já vinculada ao Asaas ou a outra loja não pode
    // conectar esta loja Shopify (precisa de outra conta). Usuário recém-criado
    // via Shopify passa (sem Asaas / sem outra loja).
    await this.shopifyService.assertCanConnectShopify(user.id, shop);

    // 4. Salvar conexão vinculada a este usuário
    const connection = await this.shopifyService.createOrUpdateConnection(
      user.id,
      shop,
      tokenData.access_token,
      tokenData.scope,
      tokenData.refresh_token,
      tokenData.expires_in,
    );

    // 5. Gerar token JWT para o CRM
    const jwtToken = this.jwtService.sign({ sub: user.id, email: user.email, role: user.role });

    // Redirecionamento direto (HTML): NUNCA colocar o JWT na URL — query strings
    // vazam em histórico, logs de servidor e header Referer. O merchant cai na
    // página de integrações e autentica pelo fluxo normal (login ou session token
    // embedded). O fluxo padrão (frontend via fetch) recebe o token no corpo JSON.
    if (req.headers['accept']?.includes('text/html')) {
      const redirectUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/integracoes?shopify=connected&shop=${encodeURIComponent(shop)}`;
      const responseObj = (req as any).res;
      responseObj.setHeader('Content-Type', 'text/html');
      return responseObj.send(this.getBreakoutHtml(redirectUrl));
    }

    return {
      success: true,
      token: jwtToken,
      connection: {
        id: connection.id,
        shop: connection.shop,
        isActive: connection.isActive,
      },
    };
  }

  /**
   * Autenticação embedded: troca um session token (idToken do App Bridge) por um
   * JWT do CRM. Chamado pelo frontend quando roda dentro do admin da Shopify.
   * NÃO usa JwtAuthGuard — a autenticação é o próprio session token da Shopify.
   *
   * Managed installation: se a loja ainda não tem conexão no nosso lado
   * (primeiro acesso), o próprio session token é trocado por um access token
   * offline via token exchange e a conexão + usuário são provisionados aqui —
   * sem redirect para o fluxo OAuth legado.
   */
  @Post('session/token-exchange')
  @HttpCode(HttpStatus.OK)
  async sessionTokenExchange(
    @Headers('authorization') authHeader: string,
    @Body() body: { sessionToken?: string },
  ) {
    const token =
      body?.sessionToken ||
      (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : '');

    if (!token) {
      throw new BadRequestException('sessionToken é obrigatório');
    }

    let shop: string;
    let user: User;
    try {
      ({ shop, user } = await this.shopifyService.authenticateSessionToken(token));
    } catch (error) {
      if (error instanceof NotFoundException) {
        // Loja sem conexão: primeiro acesso via managed install → token exchange.
        ({ shop, user } = await this.shopifyService.provisionConnectionFromSessionToken(token));
      } else {
        throw error;
      }
    }

    const jwtToken = this.jwtService.sign({ sub: user.id, email: user.email, role: user.role });

    return {
      token: jwtToken,
      shop,
      // Shape esperado pelo AuthContext do frontend (localStorage 'user').
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    };
  }

  /**
   * Lista conexões do usuário
   */
  @Get('connections')
  @UseGuards(JwtAuthGuard)
  async getConnections(@Request() req) {
    console.log(`[Shopify API] Buscando conexões para usuário ${req.user.userId}`);
    const connections = await this.shopifyService.getConnections(req.user.userId);
    return connections.map(conn => ({
      id: conn.id,
      shop: conn.shop,
      isActive: conn.isActive,
      lastSyncAt: conn.lastSyncAt,
      createdAt: conn.createdAt,
    }));
  }

  /**
   * Sincroniza um produto
   */
  @Post('products/sync')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async syncProduct(
    @Request() req,
    @Body() syncProductsDto: SyncProductsDto,
  ) {
    const { shop, ...productData } = syncProductsDto;

    const result = await this.shopifyService.syncProduct(
      req.user.userId,
      shop,
      productData,
    );

    return {
      success: true,
      product: result,
    };
  }

  /**
   * Busca produtos da loja
   */
  @Get('products')
  @UseGuards(JwtAuthGuard)
  async getProducts(
    @Request() req,
    @Query('shop') shop: string,
    @Query('limit') limit?: string,
    @Query('page') page?: string,
  ) {
    const products = await this.shopifyService.getProducts(
      req.user.userId,
      shop,
      {
        limit: limit ? parseInt(limit) : undefined,
        page: page ? parseInt(page) : undefined,
      },
    );

    return {
      products,
      count: products.length,
    };
  }

  /**
   * Busca carrinhos abandonados
   */
  @Get('checkouts/abandoned')
  @UseGuards(JwtAuthGuard)
  async getAbandonedCheckouts(
    @Request() req,
    @Query('shop') shop: string,
    @Query('limit') limit?: string,
    @Query('created_at_min') created_at_min?: string,
    @Query('created_at_max') created_at_max?: string,
    @Query('status') status?: 'open' | 'closed',
  ) {
    const checkouts = await this.shopifyService.getAbandonedCheckouts(
      req.user.userId,
      shop,
      {
        limit: limit ? parseInt(limit) : undefined,
        created_at_min,
        created_at_max,
        status,
      },
    );

    return {
      checkouts,
      count: checkouts.length,
    };
  }

  /**
   * Cria um webhook
   */
  @Post('webhooks')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  async createWebhook(
    @Request() req,
    @Body() body: { shop: string; topic: string; address: string },
  ) {
    const { shop, topic, address } = body;

    const webhook = await this.shopifyService.createWebhook(
      req.user.userId,
      shop,
      topic,
      address,
    );

    return {
      success: true,
      webhook,
    };
  }

  /**
   * Lista webhooks
   */
  @Get('webhooks')
  @UseGuards(JwtAuthGuard)
  async listWebhooks(@Request() req, @Query('shop') shop: string) {
    const webhooks = await this.shopifyService.listWebhooks(
      req.user.userId,
      shop,
    );

    return {
      webhooks,
    };
  }

  /**
   * Endpoint para receber webhooks da Shopify
   * Este endpoint NÃO usa o JwtAuthGuard pois é chamado pela Shopify
   * A autenticação é feita via verificação de assinatura HMAC
   */
  @Post('webhooks/receive')
  @HttpCode(HttpStatus.OK)
  async receiveWebhook(
    @Req() req: ExpressRequest & { rawBody?: Buffer },
    @Headers('x-shopify-topic') topic: string,
    @Headers('x-shopify-shop-domain') shopDomain: string,
    @Headers('x-shopify-hmac-sha256') signature: string,
    @Headers('x-shopify-webhook-id') webhookId: string,
  ) {
    // Verificar assinatura sobre o corpo BRUTO (rawBody). Sem fallback:
    // reserializar o body quebraria o HMAC e permitiria bypass.
    const rawBody = (req as any).rawBody;
    if (!rawBody) {
      throw new BadRequestException('Corpo bruto da request indisponível para verificação HMAC');
    }
    const secret = process.env.SHOPIFY_CLIENT_SECRET || process.env.SHOPIFY_WEBHOOK_SECRET || '';

    if (!this.shopifyService.verifyWebhookSignature(rawBody, signature, secret)) {
      throw new UnauthorizedException('Assinatura inválida');
    }

    // Dedupe: a Shopify reentrega o mesmo evento quando não recebe 200 a tempo.
    // Sem isto, uma reentrega de orders/create duplicaria vendas.
    const isNew = await this.shopifyService.registerWebhookEvent(webhookId, topic, shopDomain);
    if (!isNew) {
      return { success: true, topic, shop: shopDomain, deduplicated: true };
    }

    // Processar webhook
    const data = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    try {
      await this.shopifyService.handleWebhook(topic, shopDomain, data);
    } catch (error) {
      // Liberar o dedupe: a falha deve ser retentável quando a Shopify reentregar.
      await this.shopifyService.unregisterWebhookEvent(webhookId);
      throw error;
    }

    return {
      success: true,
      topic,
      shop: shopDomain,
    };
  }

  /**
   * Endpoints de Conformidade (Mandatórios pela Shopify)
   * Pode ser usado com tópico na URL (/compliance/customers-redact) 
   * ou em uma única URL (/compliance) usando o header X-Shopify-Topic
   */
  @Post('webhooks/compliance')
  @Post('webhooks/compliance/:topic')
  @HttpCode(HttpStatus.OK)
  async receiveComplianceWebhook(
    @Req() req: ExpressRequest & { rawBody?: Buffer },
    @Param('topic') topicParam: string,
    @Headers('x-shopify-topic') topicHeader: string,
    @Headers('x-shopify-shop-domain') shopDomain: string,
    @Headers('x-shopify-hmac-sha256') signature: string,
  ) {
    const topic = topicHeader || (topicParam ? topicParam.replace(/-/g, '/') : 'unknown');
    const body = (req as any).rawBody;
    if (!body) {
      throw new BadRequestException('Corpo bruto da request indisponível para verificação HMAC');
    }
    const secret = process.env.SHOPIFY_CLIENT_SECRET || process.env.SHOPIFY_WEBHOOK_SECRET || '';

    if (!this.shopifyService.verifyWebhookSignature(body, signature, secret)) {
      this.shopifyService['logger'].error(`[Shopify Compliance] Assinatura inválida para tópico: ${topic}`);
      // Shopify exige 401 para assinatura inválida
      throw new UnauthorizedException('Assinatura inválida');
    }

    const data = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    await this.shopifyService.handleComplianceWebhook(topic, shopDomain, data);

    return { success: true };
  }

  /**
   * Solicitações de dados de clientes (customers/data_request) da conta.
   * O merchant é quem responde ao cliente final — aqui ele obtém o conteúdo.
   */
  @Get('compliance/data-requests')
  @UseGuards(JwtAuthGuard)
  async listDataRequests(@Request() req) {
    return this.shopifyService.listDataRequests(req.user.userId);
  }

  /**
   * Conteúdo completo de uma solicitação (só do próprio dono).
   */
  @Get('compliance/data-requests/:id')
  @UseGuards(JwtAuthGuard)
  async getDataRequest(@Request() req, @Param('id') id: string) {
    return this.shopifyService.getDataRequest(req.user.userId, Number(id));
  }

  /**
   * Desconecta uma loja
   */
  @Post('disconnect')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async disconnect(@Request() req, @Body() body: { shop: string }) {
    await this.shopifyService.deactivateConnection(req.user.userId, body.shop);

    return {
      success: true,
      message: 'Conexão desativada com sucesso',
    };
  }

  /**
   * Sincroniza clientes da Shopify
   */
  @Post('sync/customers')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async syncCustomers(@Request() req, @Body() body: { shop: string }) {
    const result = await this.shopifyService.syncCustomers(req.user.userId, body.shop);
    return {
      success: true,
      ...result,
    };
  }

  /**
   * Sincroniza pedidos da Shopify
   */
  @Post('sync/orders')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async syncOrders(@Request() req, @Body() body: { shop: string }) {
    const result = await this.shopifyService.syncOrders(req.user.userId, body.shop);
    return {
      success: true,
      ...result,
    };
  }

  /**
   * Sincroniza carrinhos ativos e abandonados da Shopify (checkouts)
   */
  @Post('sync/checkouts')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async syncCheckouts(@Request() req, @Body() body: { shop: string }) {
    const result = await this.shopifyService.syncCheckouts(req.user.userId, body.shop);
    return {
      success: true,
      ...result,
    };
  }

  /**
   * Sincroniza produtos da Shopify para o CRM
   */
  @Post('sync/products-to-crm')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async syncProductsToCrm(@Request() req, @Body() body: { shop: string }) {
    const result = await this.shopifyService.syncProductsToCrm(req.user.userId, body.shop);
    return {
      success: true,
      ...result,
    };
  }

  /**
   * Sincroniza todos os dados da Shopify de uma vez
   */
  @Post('sync-all')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async syncAll(@Request() req, @Body() body: { shop?: string }) {
    const result = await this.shopifyService.syncAll(req.user.userId, body.shop);
    return {
      success: true,
      data: result,
    };
  }

  /**
   * Cria um cupom de forma isolada
   */
  @Post('coupons')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  async createCoupon(
    @Request() req,
    @Body() body: {
      shop?: string;
      title: string;
      code: string;
      value: string;
      valueType: 'percentage' | 'fixed';
      endsAt?: string;
    }
  ) {
    let shop = body.shop;
    if (!shop) {
      const connections = await this.shopifyService.getConnections(req.user.userId);
      const activeConn = connections.find(c => c.isActive);
      if (!activeConn) {
        throw new Error('Nenhuma loja conectada ativa encontrada. É necessário fornecer { shop } no body ou ativar uma conexão.');
      }
      shop = activeConn.shop;
    }

    const result = await this.shopifyService.createDiscountCode(
      req.user.userId,
      shop,
      {
        title: body.title,
        code: body.code,
        value: body.value,
        valueType: body.valueType,
        endsAt: body.endsAt,
      }
    );

    return {
      success: true,
      result
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SHOPIFY BILLING API
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Callback da Shopify após o merchant aprovar (ou recusar) a cobrança.
   * A Shopify redireciona para cá com ?charge_id= (o ?shop= vem do nosso returnUrl).
   *
   * Segurança: nenhum dado de identidade vem da URL. O charge_id resolve a
   * assinatura local `pending` criada em POST /subscriptions/shopify/checkout;
   * dono, plano e preço saem desse registro, e o status é confirmado na Admin API
   * com o token da conexão do próprio dono. A ativação primária acontece pelo
   * webhook app_subscriptions/update — este callback só confirma e redireciona.
   */
  @Get('billing/callback')
  @HttpCode(HttpStatus.OK)
  async billingCallback(
    @Res() res: ExpressResponse,
    @Query('charge_id') chargeId: string,
    @Query('shop') shop: string,
  ) {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const redirectHtml = (params: string) => {
      const redirectUrl = `${frontendUrl}/integrations/shopify/billing/callback?${params}`;
      res.setHeader('Content-Type', 'text/html');
      return res.send(this.getBreakoutHtml(redirectUrl));
    };

    if (!chargeId || !shop || !this.shopifyService.validateShopDomain(shop)) {
      return redirectHtml('error=missing_params');
    }

    try {
      const gid = chargeId.includes('/')
        ? chargeId
        : `gid://shopify/AppSubscription/${chargeId}`;

      // Assinatura local pendente criada no checkout — fonte da verdade de dono/plano.
      const localSub = await this.subscriptionRepository.findOne({
        where: { shopifySubscriptionId: gid },
      });
      if (!localSub) {
        this.shopifyService['logger'].warn(`[Shopify Billing Callback] charge ${gid} sem assinatura local correspondente (shop=${shop})`);
        return redirectHtml('error=unknown_subscription');
      }

      // A loja do callback precisa ser uma conexão ativa DO DONO da assinatura.
      const connection = await this.shopifyService.findActiveConnectionByShop(shop);
      if (!connection || connection.userId !== localSub.userId) {
        this.shopifyService['logger'].warn(`[Shopify Billing Callback] loja ${shop} não pertence ao dono da assinatura ${localSub.id}`);
        return redirectHtml('error=connection_mismatch');
      }

      // Idempotência: o webhook app_subscriptions/update pode já ter ativado.
      if (localSub.status === 'active') {
        return redirectHtml(`success=true&shop=${encodeURIComponent(shop)}`);
      }

      const accessToken = this.shopifyService['decryptToken'](connection.accessToken);
      const subStatus = await this.shopifyService.getAppSubscriptionStatus(shop, accessToken, gid);

      if (subStatus.status !== 'ACTIVE') {
        this.shopifyService['logger'].warn(`[Shopify Billing] Assinatura ${gid} com status: ${subStatus.status}`);
        return redirectHtml(`error=not_approved&status=${encodeURIComponent(subStatus.status)}`);
      }

      await this.activateLocalSubscription(localSub, subStatus.currentPeriodEnd);
      this.shopifyService['logger'].log(`[Shopify Billing] Assinatura ${gid} ATIVA via callback. Subscription local ${localSub.id} (userId ${localSub.userId}).`);

      return redirectHtml(`success=true&shop=${encodeURIComponent(shop)}`);
    } catch (error) {
      this.shopifyService['logger'].error(`[Shopify Billing Callback] Erro: ${error.message}`);
      return redirectHtml('error=server_error');
    }
  }

  /**
   * Ativa uma assinatura local pendente de forma idempotente: cancela outras
   * assinaturas ativas do usuário e sincroniza o plano no cadastro do usuário.
   * Mesmo efeito do webhook app_subscriptions/update (SubscriptionsService).
   */
  private async activateLocalSubscription(localSub: Subscription, currentPeriodEnd?: string | null) {
    await this.subscriptionRepository.update(
      { userId: localSub.userId, status: 'active' },
      { status: 'canceled' },
    );

    const plan = await this.planRepository.findOne({ where: { id: localSub.planId } });
    localSub.status = 'active';
    localSub.currentPeriodStart = new Date();
    localSub.currentPeriodEnd = currentPeriodEnd
      ? new Date(currentPeriodEnd)
      : new Date(Date.now() + ((plan?.interval === 'yearly' ? 365 : 30) * 24 * 60 * 60 * 1000));
    await this.subscriptionRepository.save(localSub);

    await this.userRepository.update(localSub.userId, {
      planId: localSub.planId,
      subscriptionStatus: 'active',
    });
  }

  /**
   * Cancela a assinatura Shopify ativa do usuário.
   * Body: { shop?: string }
   */
  @Post('billing/cancel')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async cancelBillingSubscription(
    @Request() req,
    @Body() body: { shop?: string },
  ) {
    let { shop } = body;
    if (!shop) {
      const connections = await this.shopifyService.getConnections(req.user.userId);
      const active = connections.find(c => c.isActive);
      if (!active) throw new BadRequestException('Nenhuma loja Shopify conectada.');
      shop = active.shop;
    }

    // Buscar assinatura Shopify ativa no banco
    const localSub = await this.subscriptionRepository.findOne({
      where: { userId: req.user.userId, status: 'active' },
      order: { createdAt: 'DESC' },
    });

    if (!localSub?.shopifySubscriptionId) {
      throw new NotFoundException('Nenhuma assinatura Shopify ativa encontrada para cancelar.');
    }

    const accessToken = await this.shopifyService.getAccessToken(req.user.userId, shop);

    const result = await this.shopifyService.cancelAppSubscription(
      shop,
      accessToken,
      localSub.shopifySubscriptionId,
    );

    // Atualizar registro local
    localSub.status = 'canceled';
    await this.subscriptionRepository.save(localSub);

    return {
      success: true,
      message: 'Assinatura Shopify cancelada com sucesso.',
      shopifyStatus: result.status,
    };
  }
}
