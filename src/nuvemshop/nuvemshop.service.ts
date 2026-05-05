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
import { NuvemshopConnection } from '../entities/nuvemshop-connection.entity';
import { Contact } from '../entities/contact.entity';
import { Sale } from '../entities/sale.entity';
import { Product } from '../entities/product.entity';
import * as crypto from 'crypto';

@Injectable()
export class NuvemshopService {
  private readonly logger = new Logger(NuvemshopService.name);
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly apiBaseUrl: string = 'https://api.nuvemshop.com.br/v1';
  private readonly authBaseUrl: string = 'https://www.nuvemshop.com.br/apps';
  private readonly scopes: string = 'read_products,write_products,read_orders,write_orders,read_checkouts,write_checkouts,read_coupons,write_coupons,read_customers,write_customers';

  constructor(
    @InjectRepository(NuvemshopConnection)
    private nuvemshopConnectionRepository: Repository<NuvemshopConnection>,
    @InjectRepository(Contact)
    private contactRepository: Repository<Contact>,
    @InjectRepository(Sale)
    private saleRepository: Repository<Sale>,
    @InjectRepository(Product)
    private productRepository: Repository<Product>,
    private configService: ConfigService,
  ) {
    this.clientId = this.configService.get<string>('NUVEMSHOP_CLIENT_ID') || '24731';
    this.clientSecret =
      this.configService.get<string>('NUVEMSHOP_CLIENT_SECRET') || 'bff8303f400b05b63945f07dc77de74e142e890eba84face';
  }

  /**
   * Gera a URL de autorização OAuth
   * Nota: A Nuvemshop não suporta passar scopes na URL de autorização
   * Os scopes são configurados no painel do desenvolvedor do app
   */
  generateAuthUrl(state: string): string {
    return `${this.authBaseUrl}/${this.clientId}/authorize?state=${state}&scope=${encodeURIComponent(this.scopes)}`;
  }

  /**
   * Troca o código de autorização por um token de acesso permanente
   */
  async exchangeCodeForToken(
    code: string,
  ): Promise<{ access_token: string; token_type: string; scope: string; user_id: string }> {
    const response = await fetch(
      `${this.authBaseUrl}/authorize/token`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: 'authorization_code',
          code: code,
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      let error;
      try {
        error = JSON.parse(errorText);
      } catch {
        error = { message: errorText || 'Falha ao obter token de acesso' };
      }

      console.error('Erro ao trocar código por token:', {
        status: response.status,
        statusText: response.statusText,
        error,
      });

      throw new BadRequestException(
        error.error_description || error.message || error.error || 'Falha ao obter token de acesso',
      );
    }

    const tokenData = await response.json();

    // Validar resposta
    if (!tokenData.access_token || !tokenData.user_id) {
      console.error('Resposta inválida da Nuvemshop:', tokenData);
      throw new BadRequestException('Resposta inválida da Nuvemshop: token ou user_id não encontrados');
    }

    // Log para debug
    console.log('Token obtido com sucesso:', {
      tokenLength: tokenData.access_token.length,
      tokenPrefix: tokenData.access_token.substring(0, 20) + '...',
      userId: tokenData.user_id,
      scope: tokenData.scope,
      tokenType: tokenData.token_type,
    });

    return tokenData;
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
    try {
      const algorithm = 'aes-256-cbc';
      const key = crypto
        .createHash('sha256')
        .update(this.clientSecret || 'default-secret')
        .digest();

      const parts = encryptedToken.split(':');
      if (parts.length !== 2) {
        throw new Error('Formato de token criptografado inválido');
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
      console.error('Erro ao descriptografar token:', error);
      throw new Error('Falha ao descriptografar token. O token pode estar corrompido.');
    }
  }

  /**
   * Cria ou atualiza uma conexão Nuvemshop
   */
  async createOrUpdateConnection(
    userId: number,
    storeId: string,
    accessToken: string,
    scope: string,
  ): Promise<NuvemshopConnection> {
    // Log para debug (remover em produção)
    console.log('Salvando conexão Nuvemshop:', {
      userId,
      storeId,
      tokenLength: accessToken.length,
      tokenComplete: accessToken, // Log completo temporário para debug
      tokenPrefix: accessToken.substring(0, 20) + '...',
      scope,
    });

    const encryptedToken = this.encryptToken(accessToken);

    // Log para debug (remover em produção)
    console.log('Token criptografado:', {
      encryptedLength: encryptedToken.length,
      encryptedPrefix: encryptedToken.substring(0, 30) + '...',
    });

    let connection = await this.nuvemshopConnectionRepository.findOne({
      where: { userId, storeId },
    });

    if (connection) {
      connection.accessToken = encryptedToken;
      connection.scope = scope;
      connection.isActive = true;
      connection.lastSyncAt = new Date();
    } else {
      connection = this.nuvemshopConnectionRepository.create({
        userId,
        storeId,
        accessToken: encryptedToken,
        scope,
        isActive: true,
        lastSyncAt: new Date(),
      });
    }

    const saved = await this.nuvemshopConnectionRepository.save(connection);

    // Verificar se o token foi salvo corretamente fazendo um teste de descriptografia
    try {
      const testDecrypt = this.decryptToken(saved.accessToken);
      console.log('Token salvo e verificado com sucesso:', {
        decryptedLength: testDecrypt.length,
        matches: testDecrypt === accessToken,
        originalToken: accessToken, // Log completo temporário
        decryptedToken: testDecrypt, // Log completo temporário
      });

      // Verificar se o escopo inclui read_products
      if (scope && !scope.includes('read_products')) {
        console.error('ERRO CRÍTICO: O token não tem o escopo read_products!');
        console.error('Escopo atual recebido da Nuvemshop:', scope);
        console.error('AÇÃO NECESSÁRIA: Configure o escopo "read_products" no painel de desenvolvedor da Nuvemshop para o App ID:', this.clientId);
        console.error('Isso causará erros ao tentar buscar produtos da API.');
      }
    } catch (error) {
      console.error('ERRO: Token não pode ser descriptografado após salvar!', error);
    }

    return saved;
  }

  /**
   * Busca uma conexão ativa do usuário
   */
  async getActiveConnection(
    userId: number,
    storeId?: string,
  ): Promise<NuvemshopConnection> {
    const where: any = { userId, isActive: true };
    if (storeId) {
      where.storeId = storeId;
    }

    const connection = await this.nuvemshopConnectionRepository.findOne({
      where,
    });

    if (!connection) {
      throw new NotFoundException('Conexão Nuvemshop não encontrada');
    }

    return connection;
  }

  /**
   * Obtém o token de acesso descriptografado
   */
  async getAccessToken(userId: number, storeId?: string): Promise<string> {
    const connection = await this.getActiveConnection(userId, storeId);

    if (!connection || !connection.accessToken) {
      throw new BadRequestException('Token de acesso não encontrado na conexão');
    }

    try {
      // Log para debug (remover em produção)
      console.log('Descriptografando token:', {
        userId,
        storeId,
        encryptedLength: connection.accessToken.length,
        encryptedPrefix: connection.accessToken.substring(0, 20) + '...',
      });

      const token = this.decryptToken(connection.accessToken);

      // Log para debug (remover em produção)
      console.log('Token descriptografado:', {
        tokenLength: token.length,
        tokenPrefix: token.substring(0, 20) + '...',
      });

      if (!token || token.trim().length === 0) {
        throw new BadRequestException('Token de acesso inválido ou vazio');
      }

      return token;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      // Se houver erro na descriptografia, pode ser que o token esteja corrompido
      console.error('Erro ao descriptografar token:', {
        error: error instanceof Error ? error.message : String(error),
        userId,
        storeId,
        encryptedTokenLength: connection.accessToken.length,
      });
      throw new BadRequestException('Erro ao descriptografar token de acesso. Pode ser necessário reconectar a integração.');
    }
  }

  /**
   * Testa se o token está válido fazendo uma requisição simples
   */
  async testToken(userId: number, storeId: string): Promise<boolean> {
    try {
      const accessToken = await this.getAccessToken(userId, storeId);

      // Fazer uma requisição simples para verificar se o token é válido
      const response = await fetch(
        `${this.apiBaseUrl}/${storeId}/products?limit=1`,
        {
          headers: {
            'Authentication': `bearer ${accessToken}`,
            'User-Agent': 'Nucleo CRM (https://nucleocrm.com.br)',
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
        },
      );

      return response.ok;
    } catch (error) {
      console.error('Erro ao testar token:', error);
      return false;
    }
  }

  /**
   * Sincroniza um produto (criar ou atualizar)
   * Nota: Ao atualizar (PUT), não podemos enviar variants - use updateVariant separadamente
   */
  async syncProduct(
    userId: number,
    storeId: string,
    productData: {
      name: { pt?: string; en?: string; es?: string };
      description?: { pt?: string; en?: string; es?: string };
      variants?: Array<{
        price: string;
        stock_management: boolean;
        stock: number;
        weight: string;
        sku?: string;
        id?: number;
      }>;
      images?: Array<{ src: string }>;
      categories?: number[];
      id?: number;
    },
  ): Promise<any> {
    const accessToken = await this.getAccessToken(userId, storeId);

    // Separar variants do produto (variants não podem ser enviados no PUT)
    const { variants, ...productDataWithoutVariants } = productData;

    const url = productData.id
      ? `${this.apiBaseUrl}/${storeId}/products/${productData.id}`
      : `${this.apiBaseUrl}/${storeId}/products`;

    const response = await fetch(url, {
      method: productData.id ? 'PUT' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authentication': `bearer ${accessToken}`,
        'User-Agent': 'Nucleo CRM (https://nucleocrm.com.br)',
      },
      // Ao atualizar (PUT), não enviar variants
      body: JSON.stringify(productData.id ? productDataWithoutVariants : productData),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let error;
      try {
        error = JSON.parse(errorText);
      } catch {
        error = { message: errorText || 'Falha ao sincronizar produto' };
      }

      console.error('Erro ao sincronizar produto na Nuvemshop:', {
        status: response.status,
        statusText: response.statusText,
        error,
        url,
        productData: {
          ...productData,
          id: productData.id,
          hasId: !!productData.id,
        },
      });

      throw new BadRequestException(
        error.error_description || error.message || error.error || `Falha ao sincronizar produto (${response.status})`,
      );
    }

    const result = await response.json();

    // Se é atualização e temos variants, atualizar variantes separadamente
    if (productData.id && variants && variants.length > 0) {
      // Buscar variantes existentes do produto
      const productDetails = await this.getProduct(userId, storeId, productData.id);

      if (productDetails && productDetails.variants && productDetails.variants.length > 0) {
        // Atualizar primeira variante (assumindo produto simples com uma variante)
        const existingVariant = productDetails.variants[0];
        const variantToUpdate = variants[0];

        if (existingVariant.id) {
          await this.updateVariant(
            userId,
            storeId,
            productData.id,
            existingVariant.id,
            variantToUpdate,
          );
        }
      } else if (variants.length > 0) {
        // Se não tem variantes, criar uma nova
        await this.createVariant(
          userId,
          storeId,
          productData.id,
          variants[0],
        );
      }
    }

    return result;
  }

  /**
   * Busca detalhes de um produto específico
   */
  async getProduct(userId: number, storeId: string, productId: number): Promise<any> {
    const accessToken = await this.getAccessToken(userId, storeId);

    const response = await fetch(
      `${this.apiBaseUrl}/${storeId}/products/${productId}`,
      {
        headers: {
          'Authentication': `bearer ${accessToken}`,
          'User-Agent': 'Nucleo CRM (https://nucleocrm.com.br)',
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      let error;
      try {
        error = JSON.parse(errorText);
      } catch {
        error = { message: errorText || 'Falha ao buscar produto' };
      }
      throw new BadRequestException(
        error.error_description || error.message || error.error || 'Falha ao buscar produto',
      );
    }

    return await response.json();
  }

  /**
   * Atualiza uma variante de produto
   */
  async updateVariant(
    userId: number,
    storeId: string,
    productId: number,
    variantId: number,
    variantData: {
      price: string;
      stock_management: boolean;
      stock: number;
      weight: string;
      sku?: string;
    },
  ): Promise<any> {
    const accessToken = await this.getAccessToken(userId, storeId);

    const response = await fetch(
      `${this.apiBaseUrl}/${storeId}/products/${productId}/variants/${variantId}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Authentication': `bearer ${accessToken}`,
          'User-Agent': 'Nucleo CRM (https://nucleocrm.com.br)',
        },
        body: JSON.stringify(variantData),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      let error;
      try {
        error = JSON.parse(errorText);
      } catch {
        error = { message: errorText || 'Falha ao atualizar variante' };
      }
      throw new BadRequestException(
        error.error_description || error.message || error.error || 'Falha ao atualizar variante',
      );
    }

    return await response.json();
  }

  /**
   * Cria uma nova variante para um produto
   */
  async createVariant(
    userId: number,
    storeId: string,
    productId: number,
    variantData: {
      price: string;
      stock_management: boolean;
      stock: number;
      weight: string;
      sku?: string;
    },
  ): Promise<any> {
    const accessToken = await this.getAccessToken(userId, storeId);

    const response = await fetch(
      `${this.apiBaseUrl}/${storeId}/products/${productId}/variants`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Authentication': `bearer ${accessToken}`,
          'User-Agent': 'Nucleo CRM (https://nucleocrm.com.br)',
        },
        body: JSON.stringify(variantData),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      let error;
      try {
        error = JSON.parse(errorText);
      } catch {
        error = { message: errorText || 'Falha ao criar variante' };
      }
      throw new BadRequestException(
        error.error_description || error.message || error.error || 'Falha ao criar variante',
      );
    }

    return await response.json();
  }

  /**
   * Busca produtos da loja Nuvemshop
   */
  async getProducts(
    userId: number,
    storeId: string,
    params?: {
      limit?: number;
      page?: number;
    },
  ): Promise<any[]> {
    const defaultParams = { limit: 200, page: 1 };
    const queryParams = new URLSearchParams();
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.page) queryParams.append('page', params.page.toString());

    return await this.makeApiRequest(userId, storeId, `/products?${queryParams.toString()}`);
  }

  private async makeApiRequest(userId: number, storeId: string, path: string, method: string = 'GET', body?: any, ignorePagination404: boolean = false): Promise<any> {
    const accessToken = await this.getAccessToken(userId, storeId);
    const url = `${this.apiBaseUrl}/${storeId}${path}`;

    const options: RequestInit = {
      method,
      headers: {
        'Authentication': `bearer ${accessToken}`,
        'User-Agent': 'Nucleo CRM (https://nucleocrm.com.br)',
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    };
    if (body) {
      options.body = JSON.stringify(body);
    }

    console.log(`[Nuvemshop API Request] ${method} ${url}`);
    const response = await fetch(url, options);

    if (!response.ok) {
      const errorText = await response.text();
      let error;
      try {
        error = JSON.parse(errorText);
      } catch {
        error = { message: errorText || `Falha na requisição para ${path}` };
      }

      console.error(`[Nuvemshop API Error] ${method} ${url} - Status: ${response.status}`, error);

      // Tratar erro 404 de página inexistente ou loja sem dados (paginação)
      if (ignorePagination404 && response.status === 404 && (error.description?.includes('Last page is') || error.message?.includes('Last page is'))) {
        console.log(`[Nuvemshop API] Página não encontrada (fim dos dados ou lista vazia). Retornando array vazio.`);
        return [];
      }

      if (response.status === 401 || response.status === 403) {
        throw new BadRequestException(error.error_description || error.message || error.error || 'Token de acesso inválido ou expirado. Pode ser necessário reconectar a loja.');
      }

      throw new BadRequestException(error.error_description || error.message || error.error || `Falha na requisição (${response.status})`);
    }

    const data = await response.json();
    if (Array.isArray(data)) return data;
    if (data.products && Array.isArray(data.products)) return data.products;
    if (data.data && Array.isArray(data.data)) return data.data;
    if (data.orders && Array.isArray(data.orders)) return data.orders;
    if (data.customers && Array.isArray(data.customers)) return data.customers;
    return data;
  }

  /**
   * Sincroniza clientes da Nuvemshop
   */
  async syncCustomers(userId: number, storeId: string): Promise<{ imported: number; updated: number }> {
    console.log(`[Nuvemshop Sync] Iniciando sincronização de clientes para loja ${storeId}`);
    let allCustomers: any[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const customers = await this.makeApiRequest(userId, storeId, `/customers?per_page=200&page=${page}`, 'GET', null, true);
      if (!customers || !Array.isArray(customers) || customers.length === 0) {
        hasMore = false;
      } else {
        allCustomers = allCustomers.concat(customers);
        page++;
      }
    }

    let imported = 0;
    let updated = 0;

    for (const sCustomer of allCustomers) {
      if (!sCustomer.email) continue;

      const normalizedEmail = sCustomer.email.toLowerCase().trim();
      let contact = await this.contactRepository.findOne({
        where: { userId, email: normalizedEmail },
      });

      if (contact) {
        let updatedContact = false;
        if (!contact.name || contact.name === 'Sem Nome') {
          contact.name = sCustomer.name?.split(' ')[0] || 'Sem Nome';
          updatedContact = true;
        }
        if (!contact.lastName && sCustomer.name?.split(' ').slice(1).join(' ')) {
          contact.lastName = sCustomer.name?.split(' ').slice(1).join(' ');
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
        if (!contact.state && sCustomer.default_address?.province) {
          contact.state = sCustomer.default_address.province;
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
          name: sCustomer.name?.split(' ')[0] || 'Sem Nome',
          lastName: sCustomer.name?.split(' ').slice(1).join(' ') || '',
          phone: sCustomer.phone || '',
          city: sCustomer.default_address?.city || '',
          state: sCustomer.default_address?.province || '',
          source: 'nuvemshop',
          status: 'customer',
        });
        await this.contactRepository.save(contact);
        imported++;
      }
    }

    const connection = await this.getActiveConnection(userId, storeId);
    connection.lastSyncAt = new Date();
    await this.nuvemshopConnectionRepository.save(connection);

    return { imported, updated };
  }

  /**
   * Sincroniza pedidos da Nuvemshop para o CRM
   */
  async syncOrders(userId: number, storeId: string): Promise<{ imported: number; updated: number }> {
    let allOrders: any[] = [];
    let page = 1;
    let hasMore = true;

    try {
      while (hasMore) {
        const orders = await this.makeApiRequest(userId, storeId, `/orders?per_page=200&page=${page}`, 'GET', null, true);
        if (!orders || !Array.isArray(orders) || orders.length === 0) {
          hasMore = false;
        } else {
          allOrders = allOrders.concat(orders);
          page++;
        }
      }
    } catch (error) {
      if (error instanceof BadRequestException && error.message.includes('read_orders')) {
        console.warn(`[Nuvemshop Sync] Falha ao sincronizar pedidos: Sem permissão read_orders. O usuário precisa reconectar o app.`);
        // Não lançamos erro aqui para permitir que clientes e produtos continuem sincronizando
        return { imported: 0, updated: 0 };
      }
      throw error;
    }

    let imported = 0;
    let updated = 0;

    for (const sOrder of allOrders) {
      const customerEmail = (sOrder.customer?.email || '').toLowerCase().trim();
      if (!customerEmail) continue;

      let contact = await this.contactRepository.findOne({ where: { userId, email: customerEmail } });
      const name = sOrder.customer?.name?.split(' ')[0] || 'Sem Nome';
      const lastName = sOrder.customer?.name?.split(' ').slice(1).join(' ') || '';
      const phone = sOrder.customer?.phone || '';

      if (!contact) {
        contact = this.contactRepository.create({
          userId,
          email: customerEmail,
          name,
          lastName,
          phone,
          source: 'nuvemshop',
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

      for (let index = 0; index < (sOrder.products || []).length; index++) {
        const item = sOrder.products[index];
        console.log(`[Nuvemshop Sync] Pedido ${sOrder.number || sOrder.id} - Recebido item:`, { sku: item.sku, name: item.name, price: item.price, quantity: item.quantity });

        // Nuvemshop often stores SKU as null or empty string. TypeORM where clause might match "null" weirdly.
        // Also it's better to log what we try to search.
        const searchConditions: any[] = [];
        if (item.sku) searchConditions.push({ userId, sku: item.sku });
        if (item.name) searchConditions.push({ userId, name: item.name });

        console.log(`[Nuvemshop Sync] Condições de busca para o produto:`, searchConditions);

        let product = searchConditions.length > 0 ? await this.productRepository.findOne({
          where: searchConditions
        }) : null;

        if (!product) {
          console.log(`[Nuvemshop Sync] Produto NÃO encontrado no CRM. Criando novo produto...`);
          product = this.productRepository.create({
            userId,
            name: item.name || 'Produto sem nome',
            sku: item.sku || '',
            price: parseFloat(item.price),
            stock: 0,
            active: true,
          });
          await this.productRepository.save(product);
          console.log(`[Nuvemshop Sync] Novo produto criado. ID: ${product.id}, Nome: "${product.name}", SKU: "${product.sku}"`);
        } else {
          console.log(`[Nuvemshop Sync] Produto ENCONTRADO no CRM. ID: ${product.id}, Nome: "${product.name}", SKU: "${product.sku}"`);
        }

        const createdAt = new Date(sOrder.created_at);
        const externalId = `nuvemshop_${sOrder.id}_${item.id || index}`;

        let statusMatch = 'processing';
        if (sOrder.status === 'cancelled') {
          statusMatch = 'cancelled';
        } else if (sOrder.shipping_status === 'delivered') {
          statusMatch = 'delivered';
        } else if (sOrder.payment_status === 'paid') {
          statusMatch = 'completed';
        } else if (sOrder.payment_status === 'pending') {
          statusMatch = 'pending';
        }

        const paymentMethod = sOrder.payment_details?.method || sOrder.gateway_name || null;

        let existingSale: Sale | null = null;
        try {
          existingSale = await this.saleRepository.findOne({
            where: { userId, externalId }
          });
        } catch (error) {
          console.error(`[Nuvemshop Sync] Erro ao buscar por externalId (${externalId}):`, error.message);
        }

        // Se não achou por externalId, tenta o fallback por data e produto
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
            console.log(`[Nuvemshop Sync] Venda encontrada via fallback (Produto e Data). ID: ${existingSale.id}`);
          }
        }

        if (existingSale) {
          let needsUpdate = false;

          if (!existingSale.contactId && contact?.id) {
            console.log(`[Nuvemshop Sync] Vinculando Contato ID ${contact.id} à Venda ID ${existingSale.id}`);
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
            console.log(`[Nuvemshop Sync] Venda ID ${existingSale.id} atualizada com sucesso.`);
          }
        } else {
          // Criar nova venda se não existir
          const sale = this.saleRepository.create({
            userId,
            productId: product.id,
            contactId: contact?.id,
            quantity: item.quantity,
            unitPrice: parseFloat(item.price),
            totalValue: parseFloat(item.price) * item.quantity,
            customerName: contact ? `${contact.name} ${contact.lastName}` : sOrder.customer?.name,
            customerEmail: customerEmail,
            channel: 'nuvemshop',
            status: statusMatch,
            paymentMethod: paymentMethod,
            createdAt: createdAt,
            externalId: externalId,
            couponCode: sOrder.coupon && sOrder.coupon.length > 0 ? sOrder.coupon[0].code : null,
          });
          await this.saleRepository.save(sale);
          imported++;
        }
        console.log(`[Nuvemshop Sync] Venda processada: Pedido #${sOrder.number || sOrder.id} - Status: ${statusMatch} - Cliente: ${customerEmail}`);
      }
    }

    const connection = await this.getActiveConnection(userId, storeId);
    connection.lastSyncAt = new Date();
    await this.nuvemshopConnectionRepository.save(connection);

    return { imported, updated };
  }

  /**
   * Sincroniza carrinhos ativos/abandonados da Nuvemshop para o CRM
   */
  async syncCheckouts(userId: number, storeId: string): Promise<{ imported: number; updated: number }> {
    this.logger.log(`[Nuvemshop Sync] Iniciando busca de checkouts para loja ${storeId}...`);
    const allCheckouts = await this.getAbandonedCheckouts(userId, storeId, { limit: 200 });
    let imported = 0;
    let updated = 0;
    const now = new Date();
    const fiveMinutesAgo = new Date(now.getTime() - (1 * 60 * 1000));
    
    this.logger.log(`[Nuvemshop Sync] Total de checkouts encontrados na API: ${allCheckouts.length}. Threshold: ${fiveMinutesAgo.toISOString()}`);

    for (const checkout of allCheckouts) {
      this.logger.log(`[Nuvemshop Sync] Analisando checkout ${checkout.id || checkout.token}. Status: ${checkout.abandoned ? 'Abandonado' : 'Ativo'}. Itens: ${checkout.products?.length || checkout.line_items?.length || 0}`);

      if (checkout.order_id || checkout.order) {
        this.logger.log(`[Nuvemshop Sync] Checkout ${checkout.id || checkout.token} ignorado por já ter sido convertido em pedido (Order ID: ${checkout.order_id || checkout.order.id}).`);
        continue;
      }

      const createdAt = checkout.created_at ? new Date(checkout.created_at) : new Date();
      
      // Critério: Apenas considerar abandonado se tiver mais de 1 minuto de inatividade para testes rápidos
      if (createdAt > fiveMinutesAgo) {
        this.logger.log(`[Nuvemshop Sync] Checkout ${checkout.id || checkout.token} ignorado por ser muito recente (${createdAt.toISOString()}). Threshold: ${fiveMinutesAgo.toISOString()}`);
        continue;
      }

      const customerEmail = (checkout.email || checkout.customer?.email || checkout.contact_email || '').toLowerCase().trim();
      if (!customerEmail) {
        this.logger.log(`[Nuvemshop Sync] Checkout ${checkout.id || checkout.token} ignorado por não ter e-mail.`);
        continue;
      }

      let contact: any = null;
      if (customerEmail) {
        contact = await this.contactRepository.findOne({ where: { userId, email: customerEmail } });
        const name = checkout.contact_name?.split(' ')[0] || checkout.customer?.name?.split(' ')[0] || checkout.shipping_address?.first_name || checkout.billing_address?.first_name || 'Sem Nome';
        const lastName = checkout.contact_name?.split(' ').slice(1).join(' ') || checkout.customer?.name?.split(' ').slice(1).join(' ') || checkout.shipping_address?.last_name || checkout.billing_address?.last_name || '';
        const phone = checkout.contact_phone || checkout.customer?.phone || checkout.shipping_address?.phone || checkout.billing_address?.phone || '';

        if (!contact) {
          contact = this.contactRepository.create({
            userId,
            email: customerEmail,
            name,
            lastName,
            phone,
            source: 'nuvemshop',
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
      }

      const externalId = `nuvemshop_checkout_${checkout.id || checkout.token}`;
      const items = checkout.products || checkout.line_items || [];
      if (items.length === 0) continue;

      for (let index = 0; index < items.length; index++) {
        const item = items[index];
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

        const checkoutStatus = 'abandoned_cart'; // Após 15min de inatividade, consideramos abandonado

        const existingSale = await this.saleRepository.findOne({
          where: { userId, externalId, productId: product.id }
        });

        if (existingSale) {
          if (existingSale.status !== checkoutStatus) {
            existingSale.status = checkoutStatus;
            await this.saleRepository.save(existingSale);
            updated++;
          }
        } else {
          const sale = this.saleRepository.create({
            userId,
            productId: product.id,
            contactId: contact?.id,
            quantity: item.quantity || 1,
            unitPrice: parseFloat(item.price || '0'),
            totalValue: parseFloat(item.price || '0') * (item.quantity || 1),
            customerName: contact ? `${contact.name} ${contact.lastName}` : (checkout.customer?.name || 'Cliente Anônimo'),
            customerEmail: customerEmail || 'anonimo@nuvemshop.com.br',
            channel: 'nuvemshop',
            status: checkoutStatus,
            createdAt: createdAt,
            externalId: externalId,
          });
          await this.saleRepository.save(sale);
          imported++;
          console.log(`[Nuvemshop Sync] Novo carrinho importado: ${externalId} - Cliente: ${customerEmail} - Criado em: ${createdAt.toISOString()}`);
        }
      }
    }

    const connection = await this.getActiveConnection(userId, storeId);
    connection.lastSyncAt = new Date();
    await this.nuvemshopConnectionRepository.save(connection);

    return { imported, updated };
  }

  /**
   * Sincroniza produtos da Nuvemshop para o CRM
   */
  async syncProductsToCrm(userId: number, storeId: string): Promise<{ imported: number; updated: number }> {
    let allProducts: any[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const products = await this.makeApiRequest(userId, storeId, `/products?per_page=200&page=${page}`, 'GET', null, true);
      if (!products || !Array.isArray(products) || products.length === 0) {
        hasMore = false;
      } else {
        allProducts = allProducts.concat(products);
        page++;
      }
    }

    let imported = 0;
    let updated = 0;

    for (const item of allProducts) {
      const price = item.variants && item.variants.length > 0 ? parseFloat(item.variants[0].price) : 0;
      const sku = item.variants && item.variants.length > 0 ? item.variants[0].sku : '';
      const stock = item.variants && item.variants.length > 0 && item.variants[0].stock ? item.variants[0].stock : 0;
      const name = item.name?.pt || item.name?.en || item.name?.es || 'Produto sem nome';
      const externalId = item.id.toString();

      // 1. Tentar buscar por ID Externo
      const jsonPath = `$.nuvemshop."${storeId}"`;
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
          coverPhoto: item.images && item.images.length > 0 ? item.images[0].src : null,
          externalIds: {
            nuvemshop: { [storeId]: externalId }
          }
        });
        await this.productRepository.save(product);
        imported++;
      } else {
        // Atualizar ID externo se não estiver presente
        const currentExternalIds = product.externalIds || {};
        const nuvemshopIds = currentExternalIds.nuvemshop || {};

        if (nuvemshopIds[storeId] !== externalId) {
          product.externalIds = {
            ...currentExternalIds,
            nuvemshop: { ...nuvemshopIds, [storeId]: externalId }
          };
        }

        product.price = price > 0 ? price : product.price;
        product.stock = stock;
        if (item.images && item.images.length > 0 && !product.coverPhoto) {
          product.coverPhoto = item.images[0].src;
        }
        await this.productRepository.save(product);
        updated++;
      }
    }

    const connection = await this.getActiveConnection(userId, storeId);
    connection.lastSyncAt = new Date();
    await this.nuvemshopConnectionRepository.save(connection);

    return { imported, updated };
  }

  /**
   * Busca carrinhos abandonados
   */
  async getAbandonedCheckouts(
    userId: number,
    storeId: string,
    params?: {
      limit?: number;
      since_id?: number;
    },
  ): Promise<any> {
    const accessToken = await this.getAccessToken(userId, storeId);

    const queryParams = new URLSearchParams();
    if (params?.limit) queryParams.append('per_page', params.limit.toString());
    if (params?.since_id) queryParams.append('since_id', params.since_id.toString());

    const url = `${this.apiBaseUrl}/${storeId}/checkouts${queryParams.toString() ? '?' + queryParams.toString() : ''}`;
    this.logger.log(`[Nuvemshop API] Solicitando checkouts: ${url}`);

    const response = await fetch(url, {
      headers: {
        'Authentication': `bearer ${accessToken}`,
        'User-Agent': 'Nucleo CRM (https://nucleocrm.com.br)',
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      this.logger.error(`[Nuvemshop API Error] ${url} - Status: ${response.status} ${JSON.stringify(error)}`);
      throw new BadRequestException(
        error.error_description || error.message || 'Falha ao buscar carrinhos abandonados',
      );
    }

    const data = await response.json();
    this.logger.log(`[Nuvemshop API] Loja ${storeId}/checkouts retornou ${Array.isArray(data) ? data.length + ' itens' : 'não é um array'}`);
    return data || [];
  }

  /**
   * Cria um webhook na Nuvemshop
   */
  async createWebhook(
    userId: number,
    storeId: string,
    event: string,
    url: string,
  ): Promise<any> {
    const accessToken = await this.getAccessToken(userId, storeId);

    const response = await fetch(
      `${this.apiBaseUrl}/${storeId}/webhooks`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Authentication': `bearer ${accessToken}`,
          'User-Agent': 'Nucleo CRM (https://nucleocrm.com.br)',
        },
        body: JSON.stringify({
          event: event,
          url: url,
        }),
      },
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new BadRequestException(
        error.error_description || error.message || 'Falha ao criar webhook',
      );
    }

    const data = await response.json();
    return data;
  }

  /**
   * Lista webhooks existentes
   */
  async listWebhooks(userId: number, storeId: string): Promise<any[]> {
    const accessToken = await this.getAccessToken(userId, storeId);

    const response = await fetch(
      `${this.apiBaseUrl}/${storeId}/webhooks`,
      {
        headers: {
          'Authentication': `bearer ${accessToken}`,
          'User-Agent': 'Nucleo CRM (https://nucleocrm.com.br)',
        },
      },
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new BadRequestException(
        error.error_description || error.message || 'Falha ao listar webhooks',
      );
    }

    const data = await response.json();
    return data || [];
  }

  /**
   * Verifica a assinatura HMAC de um webhook
   */
  verifyWebhookSignature(
    body: string,
    signature: string,
  ): boolean {
    const hmac = crypto
      .createHmac('sha256', this.clientSecret)
      .update(body, 'utf8')
      .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(hmac),
      Buffer.from(signature),
    );
  }

  /**
   * Busca todas as conexões do usuário
   */
  async getConnections(userId: number): Promise<NuvemshopConnection[]> {
    return await this.nuvemshopConnectionRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Desativa uma conexão
   */
  async deactivateConnection(
    userId: number,
    storeId: string,
  ): Promise<void> {
    const connection = await this.getActiveConnection(userId, storeId);
    connection.isActive = false;
    await this.nuvemshopConnectionRepository.save(connection);
  }

  /**
   * Cria um cupom de desconto na Nuvemshop
   */
  async createCoupon(
    userId: number,
    storeId: string,
    params: {
      code: string;
      type: 'percentage' | 'absolute' | 'shipping';
      value?: string | number;
      start_date?: string;
      end_date?: string;
      min_price?: string | number;
      max_uses?: number;
      first_consumer_purchase?: boolean;
      only_cheapest_shipping?: boolean;
    }
  ): Promise<any> {
    const accessToken = await this.getAccessToken(userId, storeId);

    // Converter valores string para number se necessário
    // E formatar datas para YYYY-MM-DD
    const formatDate = (dateStr?: string) => {
      if (!dateStr) return undefined;
      try {
        const date = new Date(dateStr);
        return date.toISOString().split('T')[0];
      } catch {
        return undefined;
      }
    };

    const formattedParams = {
      ...params,
      value: params.value ? parseFloat(params.value.toString()) : undefined,
      min_price: params.min_price ? parseFloat(params.min_price.toString()) : undefined,
      start_date: formatDate(params.start_date),
      end_date: formatDate(params.end_date),
    };

    const response = await fetch(
      `${this.apiBaseUrl}/${storeId}/coupons`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Authentication': `bearer ${accessToken}`,
          'User-Agent': 'Nucleo CRM (https://nucleocrm.com.br)',
        },
        body: JSON.stringify(formattedParams),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      let error: any;
      try {
        error = JSON.parse(errorText);
      } catch {
        error = { message: errorText || 'Falha ao criar cupom na Nuvemshop' };
      }

      this.logger.error('Erro ao criar cupom na Nuvemshop:', {
        status: response.status,
        statusText: response.statusText,
        error,
        sentParams: formattedParams,
      });

      // Se for erro de código já existente, podemos tratar ou apenas logar
      if (error.code === 400 && error.message?.toLowerCase().includes('already exists')) {
        this.logger.warn(`Cupom '${params.code}' já existe na Nuvemshop.`);
        return { code: params.code, alreadyExists: true };
      }

      const errorMessage = error.error_description || error.message || 'Falha ao criar cupom na Nuvemshop';
      throw new BadRequestException(errorMessage);
    }

    const data = await response.json();
    return data;
  }

  /**
   * Processa webhooks da Nuvemshop (carrinhos e checkouts)
   */
  async handleWebhook(storeId: string, event: string, data: any): Promise<void> {
    this.logger.log(`[Nuvemshop Webhook] Processando evento ${event} para loja ${storeId}`);

    // Buscar todas as conexões para esta loja
    const connections = await this.nuvemshopConnectionRepository.find({
      where: { storeId, isActive: true }
    });

    if (connections.length === 0) {
      this.logger.warn(`[Nuvemshop Webhook] Nenhuma conexão ativa encontrada para a loja ${storeId}`);
      return;
    }

    for (const connection of connections) {
      const userId = connection.userId;

      try {
        if (event.includes('checkout')) {
          await this.processCartWebhook(userId, event, data);
        } else if (event.includes('order')) {
          // A lógica de sincronização de pedidos já existe no syncOrders.
        }
      } catch (error) {
        this.logger.error(`[Nuvemshop Webhook] Erro ao processar webhook para usuário ${userId}:`, error.message);
      }
    }
  }

  /**
   * Processa webhooks de checkout da Nuvemshop
   */
  private async processCartWebhook(userId: number, event: string, data: any): Promise<void> {
    const customerEmail = data.customer?.email || data.email;
    if (!customerEmail) return;

    // Buscar ou criar contato
    let contact = await this.contactRepository.findOne({ where: { userId, email: customerEmail } });
    if (!contact) {
      contact = this.contactRepository.create({
        userId,
        email: customerEmail,
        name: data.customer?.name?.split(' ')[0] || 'Sem Nome',
        lastName: data.customer?.name?.split(' ').slice(1).join(' ') || '',
        source: 'nuvemshop',
        status: 'customer',
      });
      await this.contactRepository.save(contact);
    }

    const items = data.products || data.line_items || [];
    const externalId = `nuvemshop_checkout_${data.id || data.token}`;
    const checkoutStatus = data.abandoned ? 'abandoned_cart' : 'active_cart';

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
          quantity: item.quantity || 1,
          unitPrice: parseFloat(item.price || '0'),
          totalValue: parseFloat(item.price || '0') * (item.quantity || 1),
          customerName: `${contact.name} ${contact.lastName}`,
          customerEmail: customerEmail,
          channel: 'nuvemshop',
          status: checkoutStatus,
          createdAt: new Date(),
          externalId: externalId,
        });
        await this.saleRepository.save(sale);
      }
    }
  }
  /**
   * Sincroniza todos os dados da Nuvemshop (Clientes, Pedidos e Produtos)
   */
  async syncAll(userId: number, storeId?: string): Promise<any> {
    const connection = await this.getActiveConnection(userId, storeId);
    const resolvedStoreId = connection.storeId;

    this.logger.log(`[Nuvemshop Sync] Iniciando sincronização global para loja ${resolvedStoreId}`);

    const customers = await this.syncCustomers(userId, resolvedStoreId);
    const orders = await this.syncOrders(userId, resolvedStoreId);
    const products = await this.syncProductsToCrm(userId, resolvedStoreId);
    
    // Sincronizar e persistir checkouts abandonados
    let checkoutSyncResult = { imported: 0, updated: 0 };
    try {
      this.logger.log(`[Nuvemshop Sync] Iniciando sincronização de checkouts...`);
      checkoutSyncResult = await this.syncCheckouts(userId, resolvedStoreId);
      this.logger.log(`[Nuvemshop Sync] Checkouts sincronizados: ${checkoutSyncResult.imported} novos, ${checkoutSyncResult.updated} atualizados`);
    } catch (e) {
      this.logger.error(`Erro ao sincronizar checkouts da Nuvemshop: ${e.message}`);
    }

    return {
      customers,
      orders,
      products,
      checkouts: checkoutSyncResult
    };
  }
}
