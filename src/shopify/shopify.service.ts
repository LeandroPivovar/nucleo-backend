import {
  Injectable,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { ShopifyConnection } from '../entities/shopify-connection.entity';
import { Contact } from '../entities/contact.entity';
import { Sale } from '../entities/sale.entity';
import { Product } from '../entities/product.entity';
import * as crypto from 'crypto';

@Injectable()
export class ShopifyService {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly apiVersion: string = '2024-07';
  private readonly scopes: string = 'write_products,read_orders,read_customers,read_checkouts,write_discounts,read_discounts,write_gift_cards,read_gift_cards';
  private readonly logger = new Logger(ShopifyService.name);

  constructor(
    @InjectRepository(ShopifyConnection)
    private shopifyConnectionRepository: Repository<ShopifyConnection>,
    @InjectRepository(Contact)
    private contactRepository: Repository<Contact>,
    @InjectRepository(Sale)
    private saleRepository: Repository<Sale>,
    @InjectRepository(Product)
    private productRepository: Repository<Product>,
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
   * Busca produtos da loja Shopify
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

    const queryParams = new URLSearchParams();
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.page) queryParams.append('page', params.page.toString());

    const url = `https://${shop}/admin/api/${this.apiVersion}/products.json${queryParams.toString() ? '?' + queryParams.toString() : ''}`;

    const response = await fetch(url, {
      headers: {
        'X-Shopify-Access-Token': accessToken,
      },
    });

    if (!response.ok) {
      throw new BadRequestException('Falha ao buscar produtos');
    }

    const data = await response.json();
    return data.products || [];
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

  /**
   * Busca clientes da loja Shopify
   */
  async getCustomers(
    userId: number,
    shop: string,
    params?: { limit?: number; page_info?: string },
  ): Promise<any[]> {
    const accessToken = await this.getAccessToken(userId, shop);
    const queryParams = new URLSearchParams();
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.page_info) queryParams.append('page_info', params.page_info);

    const url = `https://${shop}/admin/api/${this.apiVersion}/customers.json${queryParams.toString() ? '?' + queryParams.toString() : ''}`;
    const response = await fetch(url, {
      headers: { 'X-Shopify-Access-Token': accessToken },
    });

    if (!response.ok) throw new BadRequestException('Falha ao buscar clientes da Shopify');
    const data = await response.json();
    return data.customers || [];
  }

  /**
   * Busca pedidos da loja Shopify
   */
  async getOrders(
    userId: number,
    shop: string,
    params?: { limit?: number; status?: string; page_info?: string },
  ): Promise<any[]> {
    const accessToken = await this.getAccessToken(userId, shop);
    const queryParams = new URLSearchParams();
    queryParams.append('status', params?.status || 'any');
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.page_info) queryParams.append('page_info', params.page_info);

    const url = `https://${shop}/admin/api/${this.apiVersion}/orders.json?${queryParams.toString()}`;
    const response = await fetch(url, {
      headers: { 'X-Shopify-Access-Token': accessToken },
    });

    if (!response.ok) throw new BadRequestException('Falha ao buscar pedidos da Shopify');
    const data = await response.json();
    return data.orders || [];
  }

  /**
   * Sincroniza clientes da Shopify para o CRM
   */
  async syncCustomers(userId: number, shop: string): Promise<{ imported: number; updated: number }> {
    const shopifyCustomers = await this.getCustomers(userId, shop, { limit: 250 });
    let imported = 0;
    let updated = 0;

    for (const sCustomer of shopifyCustomers) {
      if (!sCustomer.email) continue;

      let contact = await this.contactRepository.findOne({
        where: { userId, email: sCustomer.email },
      });

      if (contact) {
        contact.name = contact.name || sCustomer.first_name || 'Sem Nome';
        contact.lastName = contact.lastName || sCustomer.last_name || '';
        contact.phone = contact.phone || sCustomer.phone || '';
        contact.city = contact.city || sCustomer.default_address?.city || '';
        contact.state = contact.state || sCustomer.default_address?.province_code || '';
        await this.contactRepository.save(contact);
        updated++;
      } else {
        contact = this.contactRepository.create({
          userId,
          email: sCustomer.email,
          name: sCustomer.first_name || 'Sem Nome',
          lastName: sCustomer.last_name || '',
          phone: sCustomer.phone || '',
          city: sCustomer.default_address?.city || '',
          state: sCustomer.default_address?.province_code || '',
          source: 'shopify',
          status: 'customer',
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
  async syncOrders(userId: number, shop: string): Promise<{ imported: number; updated: number }> {
    const shopifyOrders = await this.getOrders(userId, shop, { limit: 250, status: 'any' });
    let imported = 0;
    let updated = 0;

    for (const sOrder of shopifyOrders) {
      // Verificar se a venda já foi importada (usando ID da Shopify no canal ou metadata)
      // Como não temos um externalId na Sale, vamos usar canal e data como proxy ou precisaríamos de um campo.
      // Vou assumir que por enquanto buscamos por email e data aproximada ou simplesmente inserimos se não houver duplicata óbvia.
      // Idealmente a Sale deveria ter um externalId.

      const customerEmail = sOrder.email || sOrder.customer?.email;
      if (!customerEmail) continue;

      // Buscar ou criar contato
      let contact = await this.contactRepository.findOne({ where: { userId, email: customerEmail } });
      if (!contact && sOrder.customer) {
        contact = this.contactRepository.create({
          userId,
          email: customerEmail,
          name: sOrder.customer.first_name || 'Sem Nome',
          lastName: sOrder.customer.last_name || '',
          source: 'shopify',
          status: 'customer',
        });
        await this.contactRepository.save(contact);
      }

      // Processar itens do pedido
      for (const item of sOrder.line_items) {
        // Tentar encontrar produto pelo SKU ou Nome
        let product = await this.productRepository.findOne({
          where: [
            { userId, sku: item.sku },
            { userId, name: item.name }
          ]
        });

        if (!product) {
          // Criar produto básico se não existir
          product = this.productRepository.create({
            userId,
            name: item.name || item.title,
            sku: item.sku || '',
            price: parseFloat(item.price),
            stock: 0,
            active: true,
          });
          await this.productRepository.save(product);
        }

        // Criar a venda
        // Evitar duplicidade básica: mesma data, mesmo produto, mesmo cliente
        const createdAt = new Date(sOrder.created_at);
        const existingSale = await this.saleRepository.findOne({
          where: {
            userId,
            productId: product.id,
            contactId: contact?.id,
            createdAt: createdAt,
          }
        });

        if (!existingSale) {
          const sale = this.saleRepository.create({
            userId,
            productId: product.id,
            contactId: contact?.id,
            quantity: item.quantity,
            unitPrice: parseFloat(item.price),
            totalValue: parseFloat(item.price) * item.quantity,
            customerName: contact ? `${contact.name} ${contact.lastName}` : sOrder.customer?.first_name,
            customerEmail: customerEmail,
            channel: 'shopify',
            status: sOrder.financial_status === 'paid' ? 'completed' : 'processing',
            createdAt: createdAt,
          });
          await this.saleRepository.save(sale);
          imported++;
        } else {
          updated++;
        }
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
        usageLimit: 1, // Um uso para garantir que não seja abusado
        appliesOncePerCustomer: true,
        codes: [
          { code: params.code }
        ],
        customerGets: {
          value: params.valueType === 'percentage'
            ? { discountAmount: { amount: parseFloat(params.value), appliesOnEachItem: true } } // Percentage might need different structure but loosely assuming
            : { discountAmount: { amount: parseFloat(params.value), appliesOnEachItem: false } },
          items: {
            all: true
          }
        },
        customerSelection: {
          all: true
        },
        appliesTo: {
          products: {
            all: true
          }
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
      throw new BadRequestException('Falha ao criar código de desconto na Shopify');
    }

    const result = await response.json();

    if (result.errors) {
      throw new BadRequestException(result.errors[0].message);
    }

    if (result.data?.discountCodeBasicCreate?.userErrors?.length > 0) {
      // Se for duplicado, podemos não lançar erro (apenas ignorar) ou tratar
      const errorMessage = result.data.discountCodeBasicCreate.userErrors[0].message;
      if (!errorMessage.toLowerCase().includes('already taken')) {
        this.logger.warn(`Shopify Erro ao criar cupom: ${errorMessage}`);
        // throw new BadRequestException(`Erro criando cupom Shopify: ${errorMessage}`);
      }
    }

    return result.data?.discountCodeBasicCreate?.codeDiscountNode;
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
      customerId?: string; // GID from Shopify
      endsAt?: string;
    }
  ): Promise<{ code: string }> {
    const accessToken = await this.getAccessToken(userId, shop);

    const mutation = `
      mutation giftCardCreate($input: GiftCardCreateInput!) {
        giftCardCreate(input: $input) {
          giftCard {
            id
            initialValue {
              amount
              currencyCode
            }
            code
            expiresOn
            note
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
        initialValue: parseFloat(params.initialValue).toFixed(2),
        ...(params.note && { note: params.note }),
        ...(params.customerId && { customerId: params.customerId }),
        ...(params.endsAt && { expiresOn: params.endsAt })
      }
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
      throw new BadRequestException('Falha ao criar Gift Card na Shopify');
    }

    const result = await response.json();

    if (result.errors) {
      throw new BadRequestException(result.errors[0].message);
    }

    if (result.data?.giftCardCreate?.userErrors?.length > 0) {
      throw new BadRequestException(
        result.data.giftCardCreate.userErrors[0].message,
      );
    }

    return result.data?.giftCardCreate?.giftCard;
  }
}

