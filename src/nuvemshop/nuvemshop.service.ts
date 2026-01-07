import {
  Injectable,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { NuvemshopConnection } from '../entities/nuvemshop-connection.entity';
import * as crypto from 'crypto';

@Injectable()
export class NuvemshopService {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly apiBaseUrl: string = 'https://api.nuvemshop.com.br/v1';
  private readonly authBaseUrl: string = 'https://www.nuvemshop.com.br/apps';
  private readonly scopes: string = 'read_products,write_products,read_orders,write_orders,read_checkouts,write_checkouts';

  constructor(
    @InjectRepository(NuvemshopConnection)
    private nuvemshopConnectionRepository: Repository<NuvemshopConnection>,
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
    // A Nuvemshop gerencia os scopes no painel do app, não na URL
    return `${this.authBaseUrl}/${this.clientId}/authorize?state=${state}`;
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
        console.warn('AVISO: O token não tem o escopo read_products. Escopo atual:', scope);
        console.warn('Isso pode causar erros ao tentar buscar produtos da API.');
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
      throw new UnauthorizedException('Token de acesso não encontrado na conexão');
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
        throw new UnauthorizedException('Token de acesso inválido ou vazio');
      }

      return token;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      // Se houver erro na descriptografia, pode ser que o token esteja corrompido
      console.error('Erro ao descriptografar token:', {
        error: error instanceof Error ? error.message : String(error),
        userId,
        storeId,
        encryptedTokenLength: connection.accessToken.length,
      });
      throw new UnauthorizedException('Erro ao descriptografar token de acesso. Pode ser necessário reconectar a integração.');
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
            'Authorization': `Bearer ${accessToken}`,
            'User-Agent': 'Nucleo CRM (https://nucleocrm.shop)',
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
   */
  async syncProduct(
    userId: number,
    storeId: string,
    productData: {
      name: { pt?: string; en?: string; es?: string };
      description?: { pt?: string; en?: string; es?: string };
      variants: Array<{
        price: string;
        stock_management: boolean;
        stock: number;
        weight: string;
        sku?: string;
      }>;
      images?: Array<{ src: string }>;
      categories?: number[];
      id?: number;
    },
  ): Promise<any> {
    const accessToken = await this.getAccessToken(userId, storeId);

    const url = productData.id
      ? `${this.apiBaseUrl}/${storeId}/products/${productData.id}`
      : `${this.apiBaseUrl}/${storeId}/products`;

    const response = await fetch(url, {
      method: productData.id ? 'PUT' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'User-Agent': 'Nucleo CRM (https://nucleocrm.shop)',
      },
      body: JSON.stringify(productData),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new BadRequestException(
        error.error_description || error.message || 'Falha ao sincronizar produto',
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
    try {
      const accessToken = await this.getAccessToken(userId, storeId);

      if (!accessToken) {
        throw new UnauthorizedException('Token de acesso não encontrado');
      }

      // Log detalhado do token que será usado (sem expor o token completo por segurança)
      console.log('Preparando requisição getProducts:', {
        userId,
        storeId,
        tokenLength: accessToken.length,
        tokenPrefix: accessToken.substring(0, 20),
        tokenSuffix: accessToken.substring(accessToken.length - 10),
        tokenHasSpaces: accessToken.includes(' '),
        tokenHasNewlines: accessToken.includes('\n'),
      });

      const queryParams = new URLSearchParams();
      if (params?.limit) queryParams.append('limit', params.limit.toString());
      if (params?.page) queryParams.append('page', params.page.toString());

      const url = `${this.apiBaseUrl}/${storeId}/products${queryParams.toString() ? '?' + queryParams.toString() : ''}`;

      console.log('URL da requisição:', url);
      console.log('Headers da requisição:', {
        'Authorization': `Bearer ${accessToken.substring(0, 20)}...`,
        'User-Agent': 'Nucleo CRM (https://nucleocrm.shop)',
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      });

      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'User-Agent': 'Nucleo CRM (https://nucleocrm.shop)',
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        let error;
        try {
          error = JSON.parse(errorText);
        } catch {
          error = { message: errorText || 'Falha ao buscar produtos' };
        }
        
        // Log para debug (remover em produção se necessário)
        console.error('Erro ao buscar produtos da Nuvemshop:', {
          status: response.status,
          statusText: response.statusText,
          error,
          url,
        });

        if (response.status === 401 || response.status === 403) {
          throw new UnauthorizedException(
            error.error_description || error.message || error.error || 'Token de acesso inválido ou expirado',
          );
        }

        throw new BadRequestException(
          error.error_description || error.message || error.error || `Falha ao buscar produtos (${response.status})`,
        );
      }

      const data = await response.json();
      // A API da Nuvemshop pode retornar um array direto ou um objeto com propriedade products
      if (Array.isArray(data)) {
        return data;
      } else if (data.products && Array.isArray(data.products)) {
        return data.products;
      } else if (data.data && Array.isArray(data.data)) {
        return data.data;
      }
      return [];
    } catch (error) {
      if (error instanceof UnauthorizedException || error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Falha ao buscar produtos da Nuvemshop',
      );
    }
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
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.since_id) queryParams.append('since_id', params.since_id.toString());

    const url = `${this.apiBaseUrl}/${storeId}/checkouts${queryParams.toString() ? '?' + queryParams.toString() : ''}`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'User-Agent': 'Nucleo CRM (https://nucleocrm.shop)',
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new BadRequestException(
        error.error_description || error.message || 'Falha ao buscar carrinhos abandonados',
      );
    }

    const data = await response.json();
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
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        'User-Agent': 'Nucleo CRM (https://nucleocrm.shop)',
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
          'Authorization': `Bearer ${accessToken}`,
        'User-Agent': 'Nucleo CRM (https://nucleocrm.shop)',
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
}

