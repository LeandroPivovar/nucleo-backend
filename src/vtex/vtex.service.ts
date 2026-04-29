import {
  Injectable,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { VtexConnection } from '../entities/vtex-connection.entity';
import { Product } from '../entities/product.entity';
import { Sale } from '../entities/sale.entity';
import { Contact } from '../entities/contact.entity';
import * as crypto from 'crypto';

@Injectable()
export class VtexService {
  private readonly encryptionKey: string;

  constructor(
    @InjectRepository(VtexConnection)
    private vtexConnectionRepository: Repository<VtexConnection>,
    @InjectRepository(Product)
    private productRepository: Repository<Product>,
    @InjectRepository(Sale)
    private saleRepository: Repository<Sale>,
    @InjectRepository(Contact)
    private contactRepository: Repository<Contact>,
    private configService: ConfigService,
  ) {
    // Usar uma chave de criptografia específica para VTEX ou uma chave geral
    // Se não existir VTEX_ENCRYPTION_KEY, usar uma chave padrão baseada em uma variável de ambiente
    this.encryptionKey =
      this.configService.get<string>('VTEX_ENCRYPTION_KEY') ||
      this.configService.get<string>('ENCRYPTION_KEY') ||
      'default-vtex-encryption-key-change-in-production';
  }

  /**
   * Valida as credenciais VTEX fazendo uma requisição de teste
   */
  async validateCredentials(
    accountName: string,
    appKey: string,
    appToken: string,
  ): Promise<boolean> {
    try {
      const baseUrl = `https://${accountName}.myvtex.com`;
      
      // Fazer uma requisição simples para validar as credenciais
      // Usando o endpoint de produtos que é comum e não requer muitos dados
      const response = await fetch(
        `${baseUrl}/api/catalog_system/pvt/products/GetProductAndSkuIds`,
        {
          method: 'GET',
          headers: {
            'X-VTEX-API-AppKey': appKey,
            'X-VTEX-API-AppToken': appToken,
            'Content-Type': 'application/json',
          },
        },
      );

      // 401 ou 403 indicam credenciais inválidas
      if (response.status === 401 || response.status === 403) {
        return false;
      }

      // 200, 204 ou até mesmo 404 (sem produtos) indicam que as credenciais são válidas
      // O importante é que não retornou 401/403
      return response.status !== 401 && response.status !== 403;
    } catch (error) {
      console.error('Erro ao validar credenciais VTEX:', error);
      return false;
    }
  }

  /**
   * Criptografa uma string (AppKey ou AppToken)
   */
  private encrypt(plaintext: string): string {
    const algorithm = 'aes-256-cbc';
    const key = crypto.createHash('sha256').update(this.encryptionKey).digest();
    const iv = crypto.randomBytes(16);

    const cipher = crypto.createCipheriv(algorithm, key, iv);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    return iv.toString('hex') + ':' + encrypted;
  }

  /**
   * Descriptografa uma string (AppKey ou AppToken)
   */
  private decrypt(encryptedText: string): string {
    try {
      const algorithm = 'aes-256-cbc';
      const key = crypto.createHash('sha256').update(this.encryptionKey).digest();

      const parts = encryptedText.split(':');
      if (parts.length !== 2) {
        throw new Error('Formato de texto criptografado inválido');
      }

      const iv = Buffer.from(parts[0], 'hex');
      const encrypted = parts[1];

      if (!iv || iv.length !== 16) {
        throw new Error('IV inválido');
      }

      const decipher = crypto.createDecipheriv(algorithm, key, iv);
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      console.error('Erro ao descriptografar:', error);
      throw new Error('Falha ao descriptografar. Os dados podem estar corrompidos.');
    }
  }

  /**
   * Cria ou atualiza uma conexão VTEX
   */
  async createOrUpdateConnection(
    userId: number,
    accountName: string,
    appKey: string,
    appToken: string,
  ): Promise<VtexConnection> {
    // Validar credenciais antes de salvar
    const isValid = await this.validateCredentials(accountName, appKey, appToken);
    
    if (!isValid) {
      throw new BadRequestException(
        'Credenciais inválidas. Verifique o Account Name, App Key e App Token.',
      );
    }

    // Criptografar credenciais
    const encryptedAppKey = this.encrypt(appKey);
    const encryptedAppToken = this.encrypt(appToken);

    // Buscar conexão existente
    let connection = await this.vtexConnectionRepository.findOne({
      where: { userId, accountName },
    });

    if (connection) {
      connection.appKey = encryptedAppKey;
      connection.appToken = encryptedAppToken;
      connection.isActive = true;
      connection.lastSyncAt = new Date();
    } else {
      connection = this.vtexConnectionRepository.create({
        userId,
        accountName,
        appKey: encryptedAppKey,
        appToken: encryptedAppToken,
        isActive: true,
        lastSyncAt: new Date(),
      });
    }

    return await this.vtexConnectionRepository.save(connection);
  }

  /**
   * Busca uma conexão ativa do usuário
   */
  async getActiveConnection(
    userId: number,
    accountName?: string,
  ): Promise<VtexConnection> {
    const where: any = { userId, isActive: true };
    if (accountName) {
      where.accountName = accountName;
    }

    const connection = await this.vtexConnectionRepository.findOne({
      where,
    });

    if (!connection) {
      throw new NotFoundException('Conexão VTEX não encontrada');
    }

    return connection;
  }

  /**
   * Lista todas as conexões do usuário
   */
  async getConnections(userId: number): Promise<VtexConnection[]> {
    return await this.vtexConnectionRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Obtém as credenciais descriptografadas
   */
  async getCredentials(
    userId: number,
    accountName?: string,
  ): Promise<{ accountName: string; appKey: string; appToken: string }> {
    const connection = await this.getActiveConnection(userId, accountName);

    try {
      const appKey = this.decrypt(connection.appKey);
      const appToken = this.decrypt(connection.appToken);

      return {
        accountName: connection.accountName,
        appKey,
        appToken,
      };
    } catch (error) {
      console.error('Erro ao descriptografar credenciais:', error);
      throw new UnauthorizedException(
        'Erro ao descriptografar credenciais. Pode ser necessário reconectar a integração.',
      );
    }
  }

  /**
   * Testa se as credenciais estão válidas
   */
  async testConnection(userId: number, accountName: string): Promise<boolean> {
    try {
      const credentials = await this.getCredentials(userId, accountName);
      return await this.validateCredentials(
        credentials.accountName,
        credentials.appKey,
        credentials.appToken,
      );
    } catch (error) {
      console.error('Erro ao testar conexão:', error);
      return false;
    }
  }

  /**
   * Desativa uma conexão
   */
  async deactivateConnection(
    userId: number,
    accountName: string,
  ): Promise<void> {
    const connection = await this.getActiveConnection(userId, accountName);
    connection.isActive = false;
    await this.vtexConnectionRepository.save(connection);
  }

  /**
   * Obtém os headers de autenticação para requisições à API VTEX
   */
  async getAuthHeaders(
    userId: number,
    accountName?: string,
  ): Promise<{ 'X-VTEX-API-AppKey': string; 'X-VTEX-API-AppToken': string }> {
    const credentials = await this.getCredentials(userId, accountName);
    return {
      'X-VTEX-API-AppKey': credentials.appKey,
      'X-VTEX-API-AppToken': credentials.appToken,
    };
  }

  /**
   * Obtém a URL base da API VTEX
   */
  getApiBaseUrl(accountName: string): string {
    return `https://${accountName}.vtexcommercestable.com.br`;
  }

  /**
   * Helper para fazer requisições à VTEX
   */
  private async makeRequest(
    userId: number,
    accountName: string,
    endpoint: string,
    options: any = {},
  ): Promise<any> {
    const credentials = await this.getCredentials(userId, accountName);
    const baseUrl = this.getApiBaseUrl(credentials.accountName);

    const response = await fetch(`${baseUrl}${endpoint}`, {
      ...options,
      headers: {
        'X-VTEX-API-AppKey': credentials.appKey,
        'X-VTEX-API-AppToken': credentials.appToken,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      if (response.status === 404) return null;
      const errorText = await response.text();
      throw new Error(`Erro na VTEX (${response.status}): ${errorText}`);
    }

    if (response.status === 204) return null;
    return await response.json();
  }

  /**
   * Sincroniza produtos da VTEX
   */
  async syncProducts(userId: number, accountName?: string): Promise<any> {
    const connection = await this.getActiveConnection(userId, accountName);
    const resolvedAccountName = connection.accountName;

    const skuIds = await this.makeRequest(
      userId,
      resolvedAccountName,
      '/api/catalog_system/pvt/sku/stockkeepingunitids?pagesize=100',
    );

    if (!skuIds || !Array.isArray(skuIds)) return { imported: 0, updated: 0 };

    let imported = 0;
    let updated = 0;

    for (const skuId of skuIds) {
      try {
        const sku = await this.makeRequest(
          userId,
          resolvedAccountName,
          `/api/catalog_system/pvt/sku/stockkeepingunitbyid/${skuId}`,
        );

        if (!sku) continue;

        let product = await this.productRepository.findOne({
          where: [
            { sku: sku.RefId || sku.Id.toString(), userId },
          ],
        });

        // Tentar encontrar por externalId se não achou por SKU
        if (!product) {
          // SQL query para buscar no JSON externalIds
          product = await this.productRepository
            .createQueryBuilder('p')
            .where('p.userId = :userId', { userId })
            .andWhere("JSON_EXTRACT(p.externalIds, '$.vtex.\"${resolvedAccountName}\"') = :extId", {
              extId: sku.ProductId.toString(),
            })
            .getOne();
        }

        const productData = {
          name: sku.NameComplete || sku.ProductName,
          description: sku.ProductDescription || '',
          price: sku.ListPrice || sku.Price || 0,
          stock: sku.AvailableQuantity || 0,
          sku: sku.RefId || sku.Id.toString(),
          active: sku.IsActive,
          userId,
          externalIds: product?.externalIds || {},
        };

        if (!productData.externalIds) productData.externalIds = {};
        if (!(productData.externalIds as any).vtex) (productData.externalIds as any).vtex = {};
        (productData.externalIds as any).vtex[resolvedAccountName] = sku.ProductId.toString();

        if (product) {
          Object.assign(product, productData);
          updated++;
        } else {
          product = this.productRepository.create(productData);
          imported++;
        }

        await this.productRepository.save(product);
      } catch (err) {
        console.error(`Erro ao sincronizar SKU ${skuId}:`, err);
      }
    }

    return { imported, updated };
  }

  /**
   * Sincroniza clientes da VTEX (Master Data CL)
   */
  async syncCustomers(userId: number, accountName?: string): Promise<any> {
    const connection = await this.getActiveConnection(userId, accountName);
    const resolvedAccountName = connection.accountName;

    const customers = await this.makeRequest(
      userId,
      resolvedAccountName,
      '/api/dataentities/CL/search?_fields=email,firstName,lastName,homePhone,phone,id',
    );

    if (!customers || !Array.isArray(customers)) return { imported: 0, updated: 0 };

    let imported = 0;
    let updated = 0;

    for (const cust of customers) {
      if (!cust.email) continue;

      let contact = await this.contactRepository.findOne({
        where: { email: cust.email, userId },
      });

      const contactData = {
        name: cust.firstName || 'Cliente',
        lastName: cust.lastName || '',
        email: cust.email,
        phone: cust.phone || cust.homePhone || '',
        userId,
        source: 'VTEX',
      };

      if (contact) {
        Object.assign(contact, contactData);
        updated++;
      } else {
        contact = this.contactRepository.create(contactData);
        imported++;
      }

      await this.contactRepository.save(contact);
    }

    return { imported, updated };
  }

  /**
   * Sincroniza pedidos da VTEX (OMS)
   */
  async syncOrders(userId: number, accountName?: string): Promise<any> {
    const connection = await this.getActiveConnection(userId, accountName);
    const resolvedAccountName = connection.accountName;

    const orders = await this.makeRequest(
      userId,
      resolvedAccountName,
      '/api/oms/pvt/orders',
    );

    if (!orders || !orders.list) return { imported: 0, updated: 0 };

    let imported = 0;
    let updated = 0;

    for (const orderSummary of orders.list) {
      try {
        const order = await this.makeRequest(
          userId,
          resolvedAccountName,
          `/api/oms/pvt/orders/${orderSummary.orderId}`,
        );

        if (!order) continue;

        let sale = await this.saleRepository.findOne({
          where: { externalId: order.orderId, userId },
        });

        // Encontrar ou criar contato
        let contact = await this.contactRepository.findOne({
          where: { email: order.clientProfileData.email, userId },
        });

        if (!contact) {
          contact = this.contactRepository.create({
            name: order.clientProfileData.firstName,
            lastName: order.clientProfileData.lastName,
            email: order.clientProfileData.email,
            phone: order.clientProfileData.phone,
            userId,
            source: 'VTEX',
          });
          await this.contactRepository.save(contact);
        }

        const saleData = {
          externalId: order.orderId,
          userId,
          contactId: contact.id,
          totalValue: order.value / 100, // VTEX envia em centavos
          status: this.mapVtexStatus(order.status),
          createdAt: new Date(order.creationDate),
          quantity: order.items.length,
          channel: 'VTEX',
        };

        if (sale) {
          Object.assign(sale, saleData);
          updated++;
        } else {
          sale = this.saleRepository.create(saleData);
          imported++;
        }

        await this.saleRepository.save(sale);
      } catch (err) {
        console.error(`Erro ao sincronizar pedido ${orderSummary.orderId}:`, err);
      }
    }

    return { imported, updated };
  }

  /**
   * Sincroniza carrinhos abandonados da VTEX
   */
  async syncAbandonedCarts(userId: number, accountName?: string): Promise<any> {
    const connection = await this.getActiveConnection(userId, accountName);
    const resolvedAccountName = connection.accountName;
    
    // Busca clientes na Entidade CL que possuem lastCart e lastCartDate
    const abandoned = await this.makeRequest(
      userId,
      resolvedAccountName,
      '/api/dataentities/CL/search?_fields=email,firstName,lastName,phone,homePhone,lastCart,lastCartDate&_where=lastCartDate is not null',
    );

    if (!abandoned || !Array.isArray(abandoned)) return { imported: 0, updated: 0 };

    let imported = 0;
    let updated = 0;

    for (const cart of abandoned) {
      if (!cart.email || !cart.lastCart) continue;

      try {
        // Encontrar ou criar contato
        let contact = await this.contactRepository.findOne({
          where: { email: cart.email, userId },
        });

        if (!contact) {
          contact = this.contactRepository.create({
            name: cart.firstName || 'Cliente',
            lastName: cart.lastName || '',
            email: cart.email,
            phone: cart.phone || cart.homePhone || '',
            userId,
            source: 'VTEX',
          });
          await this.contactRepository.save(contact);
        }

        // Extrair o ID gerado pelo VTEX
        let orderFormId = cart.lastCart;
        if (orderFormId.includes('orderFormId=')) {
          orderFormId = new URLSearchParams(orderFormId.split('?')[1]).get('orderFormId') || orderFormId;
        }

        // Tentar obter informações adicionais do OrderForm Checkout se possível
        let cartValue = 0;
        let quantity = 1;
        try {
          const orderForm = await this.makeRequest(
            userId,
            resolvedAccountName,
            `/api/checkout/pub/orderForm/${orderFormId}`
          );
          if (orderForm && orderForm.value) {
            cartValue = orderForm.value / 100; // Centavos para formato monetário
            quantity = orderForm.items?.length || 1;
          }
        } catch (err) {
          // Ignora caso o orderForm tenha expirado ou não seja encontrado
        }

        let sale = await this.saleRepository.findOne({
          where: { externalId: orderFormId, userId },
        });

        // Se a venda já existir mas com status diferente de abandonada (ex: foi paga), não atualizamos de volta
        if (sale && sale.status !== 'abandoned_cart') continue;

        const saleData = {
          externalId: orderFormId,
          userId,
          contactId: contact.id,
          totalValue: cartValue,
          status: 'abandoned_cart',
          createdAt: new Date(cart.lastCartDate),
          quantity: quantity,
          channel: 'VTEX',
        };

        if (sale) {
          Object.assign(sale, saleData);
          updated++;
        } else {
          sale = this.saleRepository.create(saleData);
          imported++;
        }

        await this.saleRepository.save(sale);
      } catch (err) {
        console.error(`Erro ao sincronizar carrinho abandonado ${cart.lastCart}:`, err);
      }
    }

    return { imported, updated };
  }

  /**
   * Monitora carrinhos abandonados via Master Data V2
   * Usa os campos nativos da entidade CL: lastCart, lastCartDate, isNewsletterOptIn
   * e complementa com dados do OrderForm quando possível.
   */
  async syncAbandonedCartsV2(userId: number, accountName?: string): Promise<{ imported: number; updated: number }> {
    const connection = await this.getActiveConnection(userId, accountName);
    const resolvedAccountName = connection.accountName;

    // Buscar clientes com lastCartDate preenchido (tiveram um carrinho)
    const rawResults = await this.makeRequest(
      userId,
      resolvedAccountName,
      '/api/dataentities/CL/search?_fields=email,firstName,lastName,phone,homePhone,lastCart,lastCartDate&_where=lastCartDate%20is%20not%20null&_sort=lastCartDate%20DESC',
    );

    if (!rawResults || !Array.isArray(rawResults)) return { imported: 0, updated: 0 };

    let imported = 0;
    let updated = 0;

    // Filtrar apenas carrinhos com mais de 30 minutos de inatividade
    const threshold = new Date(Date.now() - 30 * 60 * 1000);

    for (const record of rawResults) {
      if (!record.email || !record.lastCart) continue;

      const lastCartDate = new Date(record.lastCartDate);
      if (lastCartDate > threshold) continue; // Carrinho muito recente, ignorar

      try {
        // Encontrar ou criar contato no CRM
        let contact = await this.contactRepository.findOne({
          where: { email: record.email, userId },
        });

        if (!contact) {
          contact = this.contactRepository.create({
            name: record.firstName || 'Cliente',
            lastName: record.lastName || '',
            email: record.email,
            phone: record.phone || record.homePhone || '',
            userId,
            source: 'VTEX',
          });
          await this.contactRepository.save(contact);
        }

        // Extrair o orderFormId do link do carrinho
        let orderFormId = record.lastCart;
        if (orderFormId.includes('orderFormId=')) {
          orderFormId = new URLSearchParams(orderFormId.split('?')[1]).get('orderFormId') || orderFormId;
        }

        const externalId = `vtex_cart_${orderFormId}`;

        // Tentar buscar valor e itens do OrderForm para enriquecer os dados
        let cartValue = 0;
        let quantity = 1;
        try {
          const orderForm = await this.makeRequest(
            userId,
            resolvedAccountName,
            `/api/checkout/pub/orderForm/${orderFormId}`,
          );
          if (orderForm?.value) {
            cartValue = orderForm.value / 100;
            quantity = orderForm.items?.length || 1;
          }
        } catch {
          // OrderForm pode ter expirado - usa os dados mínimos disponíveis
        }

        // Verificar se o carrinho já foi registrado
        let sale = await this.saleRepository.findOne({
          where: { externalId, userId },
        });

        // Não sobrescrever carrinhos que já viraram pedidos pagos
        if (sale && !['abandoned_cart', 'active_cart'].includes(sale.status)) continue;

        const saleData: any = {
          externalId,
          userId,
          contactId: contact.id,
          totalValue: cartValue,
          status: 'abandoned_cart',
          createdAt: lastCartDate,
          quantity,
          channel: 'VTEX',
          customerEmail: record.email,
          customerName: contact ? `${contact.name} ${contact.lastName}`.trim() : record.firstName || 'Cliente',
        };

        if (sale) {
          Object.assign(sale, saleData);
          updated++;
        } else {
          sale = this.saleRepository.create(saleData);
          imported++;
        }

        await this.saleRepository.save(sale);
      } catch (err) {
        console.error(`[VTEX] Erro ao processar carrinho abandonado para ${record.email}:`, err.message);
      }
    }

    return { imported, updated };
  }

  /**
   * Cria um cupom de desconto na VTEX via API RNB (Rates and Benefits)
   * O cupom deve ser vinculado a uma promoção existente no painel da VTEX
   * configurada para aceitar a utmSource/utmCampaign especificada.
   */
  async createCoupon(
    userId: number,
    accountName: string,
    params: {
      couponCode: string;
      utmSource?: string;
      utmCampaign?: string;
      isArchived?: boolean;
      maxItemsPerClient?: number;
      expirationIntervalPerUse?: string;
    },
  ): Promise<any> {
    const connection = await this.getActiveConnection(userId, accountName);
    const resolvedAccountName = connection.accountName;
    const credentials = await this.getCredentials(userId, resolvedAccountName);
    const baseUrl = this.getApiBaseUrl(resolvedAccountName);

    const payload = {
      couponCode: params.couponCode,
      utmSource: params.utmSource ?? null,
      utmCampaign: params.utmCampaign ?? null,
      isArchived: params.isArchived ?? false,
      maxItemsPerClient: params.maxItemsPerClient ?? 1,
      expirationIntervalPerUse: params.expirationIntervalPerUse ?? '00:00:00',
    };

    const response = await fetch(`${baseUrl}/api/rnb/pvt/coupon`, {
      method: 'POST',
      headers: {
        'X-VTEX-API-AppKey': credentials.appKey,
        'X-VTEX-API-AppToken': credentials.appToken,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let error: any;
      try {
        error = JSON.parse(errorText);
      } catch {
        error = { message: errorText || 'Falha ao criar cupom na VTEX' };
      }

      // Tratar código de cupom já existente
      if (response.status === 409 || error?.message?.toLowerCase().includes('already exists')) {
        console.warn(`[VTEX] Cupom '${params.couponCode}' já existe.`);
        return { couponCode: params.couponCode, alreadyExists: true };
      }

      throw new BadRequestException(
        error.message || error.error || `Falha ao criar cupom na VTEX (${response.status})`,
      );
    }

    const data = await response.json();
    console.log(`[VTEX] Cupom '${params.couponCode}' criado com sucesso.`);
    return data;
  }

  private mapVtexStatus(vtexStatus: string): string {
    switch (vtexStatus) {
      case 'invoiced':
      case 'payment-approved':
        return 'completed';
      case 'canceled':
        return 'cancelled';
      case 'waiting-for-seller-decision':
        return 'processing';
      default:
        return 'pending';
    }
  }

  async syncAll(userId: number, accountName?: string): Promise<any> {
    const connection = await this.getActiveConnection(userId, accountName);
    const resolvedAccountName = connection.accountName;

    const products = await this.syncProducts(userId, resolvedAccountName);
    const customers = await this.syncCustomers(userId, resolvedAccountName);
    const orders = await this.syncOrders(userId, resolvedAccountName);

    // Usar o método V2 aprimorado para carrinhos abandonados
    let abandoned = { imported: 0, updated: 0 };
    try {
      abandoned = await this.syncAbandonedCartsV2(userId, resolvedAccountName);
    } catch (e) {
      console.error('[VTEX] Erro ao sincronizar carrinhos abandonados (V2):', e.message);
      // Fallback para o método legado
      abandoned = await this.syncAbandonedCarts(userId, resolvedAccountName);
    }

    // Atualizar lastSyncAt
    connection.lastSyncAt = new Date();
    await this.vtexConnectionRepository.save(connection);

    return {
      products,
      customers,
      orders,
      abandoned,
    };
  }
}

