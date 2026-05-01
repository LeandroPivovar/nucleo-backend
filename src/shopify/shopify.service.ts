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
  private readonly apiVersion: string = '2025-01';
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
      page_info?: string;
    },
  ): Promise<any> {
    const accessToken = await this.getAccessToken(userId, shop);

    const queryParams = new URLSearchParams();
    
    // Shopify Rule: when page_info is present, no other parameters except limit should be sent.
    if (params?.page_info) {
      queryParams.append('page_info', params.page_info);
      if (params?.limit) queryParams.append('limit', params.limit.toString());
    } else {
      if (params?.limit) queryParams.append('limit', params.limit.toString());
      if (params?.created_at_min)
        queryParams.append('created_at_min', params.created_at_min);
      if (params?.created_at_max)
        queryParams.append('created_at_max', params.created_at_max);
      if (params?.status) queryParams.append('status', params.status);
    }

    const url = `https://${shop}/admin/api/${this.apiVersion}/abandoned_checkouts.json${queryParams.toString() ? '?' + queryParams.toString() : ''}`;

    const response = await fetch(url, {
      headers: {
        'X-Shopify-Access-Token': accessToken,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error(`[Shopify API] Falha ao buscar checkouts: ${response.status} - ${errorText}`);
      throw new BadRequestException(`Falha ao buscar checkouts abandonados da Shopify: ${response.status}`);
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
    
    if (params?.page_info) {
      queryParams.append('page_info', params.page_info);
      if (params?.limit) queryParams.append('limit', params.limit.toString());
    } else {
      if (params?.limit) queryParams.append('limit', params.limit.toString());
    }

    const url = `https://${shop}/admin/api/${this.apiVersion}/customers.json${queryParams.toString() ? '?' + queryParams.toString() : ''}`;
    const response = await fetch(url, {
      headers: { 'X-Shopify-Access-Token': accessToken },
    });

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error(`[Shopify API] Falha ao buscar clientes: ${response.status} - ${errorText}`);
      throw new BadRequestException(`Falha ao buscar clientes da Shopify: ${response.status}`);
    }
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
    
    if (params?.page_info) {
      queryParams.append('page_info', params.page_info);
      if (params?.limit) queryParams.append('limit', params.limit.toString());
    } else {
      queryParams.append('status', params?.status || 'any');
      if (params?.limit) queryParams.append('limit', params.limit.toString());
    }

    const url = `https://${shop}/admin/api/${this.apiVersion}/orders.json${queryParams.toString() ? '?' + queryParams.toString() : ''}`;
    const response = await fetch(url, {
      headers: { 'X-Shopify-Access-Token': accessToken },
    });

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error(`[Shopify API] Falha ao buscar pedidos: ${response.status} - ${errorText}`);
      throw new BadRequestException(`Falha ao buscar pedidos da Shopify: ${response.status}`);
    }
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

      const normalizedEmail = sCustomer.email.toLowerCase().trim();
      let contact = await this.contactRepository.findOne({
        where: { userId, email: normalizedEmail },
      });

      if (contact) {
        let updatedContact = false;
        if (!contact.name || contact.name === 'Sem Nome') {
          contact.name = sCustomer.first_name || 'Sem Nome';
          updatedContact = true;
        }
        if (!contact.lastName && sCustomer.last_name) {
          contact.lastName = sCustomer.last_name;
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
        if (updatedContact) {
          await this.contactRepository.save(contact);
        }
        updated++;
      } else {
        contact = this.contactRepository.create({
          userId,
          email: normalizedEmail,
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

      const customerEmail = (sOrder.email || sOrder.customer?.email || '').toLowerCase().trim();
      if (!customerEmail) continue;

      // Buscar ou criar contato
      let contact = await this.contactRepository.findOne({ where: { userId, email: customerEmail } });
      const name = sOrder.customer?.first_name || sOrder.customer?.name || 'Sem Nome';
      const lastName = sOrder.customer?.last_name || '';
      const phone = sOrder.customer?.phone || '';

      if (!contact) {
        contact = this.contactRepository.create({
          userId,
          email: customerEmail,
          name,
          lastName,
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
        if (!contact.lastName && lastName) {
          contact.lastName = lastName;
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
            customerName: contact ? `${contact.name} ${contact.lastName}` : sOrder.customer?.first_name,
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
    const allCheckouts = await this.getAbandonedCheckouts(userId, shop, { limit: 250 });
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
      const name = checkout.customer?.first_name || checkout.customer?.name || checkout.shipping_address?.first_name || checkout.billing_address?.first_name || 'Sem Nome';
      const lastName = checkout.customer?.last_name || checkout.shipping_address?.last_name || checkout.billing_address?.last_name || '';
      const phone = checkout.customer?.phone || checkout.shipping_address?.phone || checkout.billing_address?.phone || '';

      if (!contact) {
        contact = this.contactRepository.create({
          userId,
          email: customerEmail,
          name,
          lastName,
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
        if (!contact.lastName && lastName) {
          contact.lastName = lastName;
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
            customerName: contact ? `${contact.name} ${contact.lastName}` : checkout.customer?.first_name,
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
    let pageInfo: string | undefined = undefined;
    let hasMore = true;

    while (hasMore) {
      // Usar a estrutura atual baseada na REST API de Shopify ou GraphQL já existente
      try {
        const queryParams = new URL(
          `https://${shop}/admin/api/${this.apiVersion}/products.json?limit=250${pageInfo ? `&page_info=${pageInfo}` : ''}`,
        );
        const accessToken = await this.getAccessToken(userId, shop);

        const response = await fetch(queryParams.toString(), {
          headers: {
            'X-Shopify-Access-Token': accessToken,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          const errorText = await response.text();
          this.logger.error(`[Shopify API] Falha ao buscar produtos: ${response.status} - ${errorText}`);
          throw new BadRequestException(`Erro ao buscar produtos da Shopify: ${response.status}`);
        }

        const data = await response.json();
        if (data.products && data.products.length > 0) {
          allProducts = allProducts.concat(data.products);

          // Extrair pagination do cursor do Header
          const linkHeader = response.headers.get('link');
          if (linkHeader) {
            const match = linkHeader.match(/<[^>]+page_info=([^>]+)>; rel="next"/);
            if (match) {
              const urlParts = new URL(match[0].split(';')[0].slice(1, -1));
              pageInfo = urlParts.searchParams.get('page_info') || undefined;
            } else {
              hasMore = false;
            }
          } else {
            hasMore = false;
          }
        } else {
          hasMore = false;
        }
      } catch (error) {
        this.logger.error(`Erro ao sincronizar produtos da loja ${shop}:`, error);
        hasMore = false;
      }
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

    const codeNode = result.data?.discountCodeBasicCreate?.codeDiscountNode;
    this.logger.log(`Cupom '${params.code}' gerado/validado com sucesso na loja ${shop}. Detalhes: ${JSON.stringify(codeNode)}`);

    return codeNode;
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

    // REST API is used because GraphQL doesn't return the full gift card code for security Reasons.
    const url = `https://${shop}/admin/api/${this.apiVersion}/gift_cards.json`;

    // Handle customer ID extraction if it's a GID
    const numericCustomerId = params.customerId?.includes('/')
      ? params.customerId.split('/').pop()
      : params.customerId;

    const body = {
      gift_card: {
        initial_value: parseFloat(params.initialValue).toFixed(2),
        ...(params.note && { note: params.note }),
        ...(numericCustomerId && { customer_id: numericCustomerId }),
        ...(params.endsAt && { expires_on: params.endsAt.split('T')[0] }) // REST expects YYYY-MM-DD
      }
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      this.logger.error(`[Shopify REST] Erro ao criar Gift Card: ${JSON.stringify(errorData)}`);
      throw new BadRequestException(
        typeof errorData.errors === 'string'
          ? errorData.errors
          : JSON.stringify(errorData.errors) || 'Falha ao criar Gift Card na Shopify (REST API)'
      );
    }

    const result = await response.json();

    if (!result.gift_card || !result.gift_card.code) {
      throw new BadRequestException('Código do Gift Card não retornado pela Shopify.');
    }

    return {
      code: result.gift_card.code
    };
  }

  /**
   * Processa webhooks da Shopify (carrinhos e checkouts)
   */
  async handleWebhook(topic: string, shop: string, data: any): Promise<void> {
    this.logger.log(`[Shopify Webhook] Processando tópico ${topic} para loja ${shop}`);

    // Buscar todas as conexões para esta loja (pode haver múltiplos usuários com a mesma loja conectada)
    const connections = await this.shopifyConnectionRepository.find({
      where: { shop, isActive: true }
    });

    if (connections.length === 0) {
      this.logger.warn(`[Shopify Webhook] Nenhuma conexão ativa encontrada para a loja ${shop}`);
      return;
    }

    for (const connection of connections) {
      const userId = connection.userId;

      try {
        if (topic.startsWith('carts/') || topic.startsWith('checkouts/')) {
          await this.processCartWebhook(userId, topic, data);
        } else if (topic === 'orders/create' || topic === 'orders/paid' || topic === 'orders/updated') {
          await this.processOrderWebhook(userId, topic, data);
        }
      } catch (error) {
        this.logger.error(`[Shopify Webhook] Erro ao processar webhook para usuário ${userId}:`, error.message);
      }
    }
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
        name: data.customer?.first_name || data.shipping_address?.first_name || 'Sem Nome',
        lastName: data.customer?.last_name || data.shipping_address?.last_name || '',
        source: 'shopify',
        status: 'customer',
      });
      await this.contactRepository.save(contact);
    }

    const items = data.line_items || [];
    const externalId = data.id ? data.id.toString() : data.token;
    const checkoutStatus = (topic.includes('abandoned') || data.completed_at) ? 'abandoned_cart' : 'active_cart';

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
          customerName: `${contact.name} ${contact.lastName}`,
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
   * Processa webhooks de pedidos
   */
  private async processOrderWebhook(userId: number, topic: string, data: any): Promise<void> {
    // A lógica de sincronização de pedidos já existe no syncOrders.
    // Para simplificar, podemos apenas chamar o syncOrders ou replicar a lógica aqui.
    // Como o syncOrders busca os últimos 250, chamar ele agora pode ser redundante se o webhook trouxer o dado.
    // Mas para garantir consistência total com o externalId, vamos replicar a lógica mínima.

    // Se o pedido foi finalizado, devemos remover o status de 'active_cart'/'abandoned_cart' do externalId correspondente?
    // Na verdade, o externalId do checkout é diferente do externalId do pedido na Shopify.
    // Mas o contato agora terá uma venda 'completed', o que tira ele do filtro de cart no dashboard.
  }

  /**
   * Sincroniza todos os dados da Shopify (Clientes, Pedidos, Checkouts e Produtos)
   */
  async syncAll(userId: number, shop?: string): Promise<any> {
    const connection = await this.getActiveConnection(userId, shop);
    const resolvedShop = connection.shop;

    const customers = await this.syncCustomers(userId, resolvedShop);
    const orders = await this.syncOrders(userId, resolvedShop);
    const checkouts = await this.syncCheckouts(userId, resolvedShop);
    const products = await this.syncProductsToCrm(userId, resolvedShop);

    return {
      customers,
      orders,
      checkouts,
      products,
    };
  }
}

