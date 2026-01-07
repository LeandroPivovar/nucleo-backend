import {
  Injectable,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { ShopifyConnection } from '../entities/shopify-connection.entity';
import * as crypto from 'crypto';

@Injectable()
export class ShopifyService {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly apiVersion: string = '2024-07';
  private readonly scopes: string = 'write_products,read_orders,read_customers,read_checkouts';

  constructor(
    @InjectRepository(ShopifyConnection)
    private shopifyConnectionRepository: Repository<ShopifyConnection>,
    private configService: ConfigService,
  ) {
    this.clientId = this.configService.get<string>('SHOPIFY_CLIENT_ID') || '';
    this.clientSecret =
      this.configService.get<string>('SHOPIFY_CLIENT_SECRET') || '';
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
   * Troca o código de autorização por um token de acesso
   */
  async exchangeCodeForToken(
    shop: string,
    code: string,
  ): Promise<{ access_token: string; scope: string }> {
    const response = await fetch(
      `https://${shop}/admin/oauth/access_token`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          code: code,
        }),
      },
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new BadRequestException(
        error.error_description || 'Falha ao obter token de acesso',
      );
    }

    return await response.json();
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
   * Cria ou atualiza uma conexão Shopify
   */
  async createOrUpdateConnection(
    userId: number,
    shop: string,
    accessToken: string,
    scope: string,
  ): Promise<ShopifyConnection> {
    const encryptedToken = this.encryptToken(accessToken);

    let connection = await this.shopifyConnectionRepository.findOne({
      where: { userId, shop },
    });

    if (connection) {
      connection.accessToken = encryptedToken;
      connection.scope = scope;
      connection.isActive = true;
      connection.lastSyncAt = new Date();
    } else {
      connection = this.shopifyConnectionRepository.create({
        userId,
        shop,
        accessToken: encryptedToken,
        scope,
        isActive: true,
        lastSyncAt: new Date(),
      });
    }

    return await this.shopifyConnectionRepository.save(connection);
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
   * Obtém o token de acesso descriptografado
   */
  async getAccessToken(userId: number, shop?: string): Promise<string> {
    const connection = await this.getActiveConnection(userId, shop);
    return this.decryptToken(connection.accessToken);
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
        inventoryQuantity?: number;
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
   * Busca carrinhos abandonados
   */
  async getAbandonedCheckouts(
    userId: number,
    shop: string,
    params?: {
      limit?: number;
      created_at_min?: string;
      created_at_max?: string;
      status?: 'open' | 'closed';
    },
  ): Promise<any> {
    const accessToken = await this.getAccessToken(userId, shop);

    const queryParams = new URLSearchParams();
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.created_at_min)
      queryParams.append('created_at_min', params.created_at_min);
    if (params?.created_at_max)
      queryParams.append('created_at_max', params.created_at_max);
    if (params?.status) queryParams.append('status', params.status);

    const url = `https://${shop}/admin/api/${this.apiVersion}/checkouts.json?${queryParams.toString()}`;

    const response = await fetch(url, {
      headers: {
        'X-Shopify-Access-Token': accessToken,
      },
    });

    if (!response.ok) {
      throw new BadRequestException('Falha ao buscar carrinhos abandonados');
    }

    const data = await response.json();
    return data.checkouts || [];
  }

  /**
   * Cria um webhook na Shopify
   */
  async createWebhook(
    userId: number,
    shop: string,
    topic: string,
    address: string,
  ): Promise<any> {
    const accessToken = await this.getAccessToken(userId, shop);

    const response = await fetch(
      `https://${shop}/admin/api/${this.apiVersion}/webhooks.json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': accessToken,
        },
        body: JSON.stringify({
          webhook: {
            topic: topic,
            address: address,
            format: 'json',
          },
        }),
      },
    );

    if (!response.ok) {
      throw new BadRequestException('Falha ao criar webhook');
    }

    const data = await response.json();
    return data.webhook;
  }

  /**
   * Lista webhooks existentes
   */
  async listWebhooks(userId: number, shop: string): Promise<any[]> {
    const accessToken = await this.getAccessToken(userId, shop);

    const response = await fetch(
      `https://${shop}/admin/api/${this.apiVersion}/webhooks.json`,
      {
        headers: {
          'X-Shopify-Access-Token': accessToken,
        },
      },
    );

    if (!response.ok) {
      throw new BadRequestException('Falha ao listar webhooks');
    }

    const data = await response.json();
    return data.webhooks || [];
  }

  /**
   * Verifica a assinatura HMAC de um webhook
   */
  verifyWebhookSignature(
    body: string,
    signature: string,
    secret: string,
  ): boolean {
    const hmac = crypto
      .createHmac('sha256', secret)
      .update(body, 'utf8')
      .digest('base64');

    return crypto.timingSafeEqual(
      Buffer.from(hmac),
      Buffer.from(signature),
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
}

