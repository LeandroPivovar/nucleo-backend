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
import { TrayConnection } from '../entities/tray-connection.entity';
import { Contact } from '../entities/contact.entity';
import { Sale } from '../entities/sale.entity';
import { Product } from '../entities/product.entity';
import { SystemSetting } from '../entities/system-setting.entity';

@Injectable()
export class TrayService {
  private readonly logger = new Logger(TrayService.name);

  constructor(
    @InjectRepository(TrayConnection)
    private trayConnectionRepository: Repository<TrayConnection>,
    @InjectRepository(Contact)
    private contactRepository: Repository<Contact>,
    @InjectRepository(Sale)
    private saleRepository: Repository<Sale>,
    @InjectRepository(Product)
    private productRepository: Repository<Product>,
    @InjectRepository(SystemSetting)
    private systemSettingRepository: Repository<SystemSetting>,
    private configService: ConfigService,
  ) {}

  /**
   * Obtém as chaves globais da Tray das configurações do sistema
   */
  private async getGlobalConfig(): Promise<{ consumerKey: string; consumerSecret: string }> {
    const keySetting = await this.systemSettingRepository.findOne({ where: { key: 'tray_consumer_key' } });
    const secretSetting = await this.systemSettingRepository.findOne({ where: { key: 'tray_consumer_secret' } });

    return {
      consumerKey: keySetting?.value || this.configService.get<string>('TRAY_CONSUMER_KEY') || '',
      consumerSecret: secretSetting?.value || this.configService.get<string>('TRAY_CONSUMER_SECRET') || '',
    };
  }

  /**
   * Gera a URL de autorização OAuth
   */
  async generateAuthUrl(shopUrl: string, state: string, callbackUrl: string): Promise<string> {
    const { consumerKey } = await this.getGlobalConfig();
    if (!consumerKey) {
      throw new BadRequestException('Configuração da Tray (Consumer Key) não encontrada no painel admin.');
    }

    // A URL da loja deve ser formatada corretamente
    const formattedShopUrl = shopUrl.startsWith('http') ? shopUrl : `https://${shopUrl}`;
    // Critério: Apenas considerar abandonado se tiver mais de 1 minuto de inatividade para testes rápidos
    return `${formattedShopUrl}/adm/auth/authorize?response_type=code&consumer_key=${consumerKey}&callback=${encodeURIComponent(callbackUrl)}&state=${state}`;
  }

  /**
   * Troca o código de autorização por tokens
   */
  async exchangeCodeForToken(shopUrl: string, code: string): Promise<any> {
    const { consumerKey, consumerSecret } = await this.getGlobalConfig();
    
    // A Tray exige que a chamada inicial para obter o api_address seja feita para a loja
    const formattedShopUrl = shopUrl.startsWith('http') ? shopUrl : `https://${shopUrl}`;
    const authUrl = `${formattedShopUrl}/web_api/auth`;

    this.logger.log(`[Tray Auth] Trocando code por token para ${shopUrl}...`);

    const response = await fetch(authUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        consumer_key: consumerKey,
        consumer_secret: consumerSecret,
        code: code,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Erro desconhecido na autenticação' }));
      this.logger.error(`[Tray Auth Error] ${JSON.stringify(error)}`);
      throw new BadRequestException(error.message || 'Falha ao autenticar com a Tray');
    }

    return await response.json();
  }

  /**
   * Renova o token de acesso usando o refresh_token
   */
  async refreshToken(connectionId: number): Promise<TrayConnection> {
    const connection = await this.trayConnectionRepository.findOne({ where: { id: connectionId } });
    if (!connection) throw new NotFoundException('Conexão Tray não encontrada');

    this.logger.log(`[Tray Auth] Renovando token para ${connection.shopUrl}...`);
    
    // O endpoint de refresh na Tray V2 é um GET com o refresh_token
    const url = `${connection.apiUrl}/auth?refresh_token=${connection.refreshToken}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      this.logger.error(`[Tray Refresh Error] Status: ${response.status}`);
      connection.isActive = false;
      await this.trayConnectionRepository.save(connection);
      throw new UnauthorizedException('Falha ao renovar token da Tray. Conexão desativada.');
    }

    const data = await response.json();
    
    connection.accessToken = data.access_token;
    connection.refreshToken = data.refresh_token;
    connection.tokenExpiresAt = new Date(Date.now() + 180 * 60 * 1000); // 180 minutos
    connection.isActive = true;

    return await this.trayConnectionRepository.save(connection);
  }

  /**
   * Salva ou atualiza uma conexão do usuário
   */
  async saveConnection(userId: number, shopUrl: string, authData: any): Promise<TrayConnection> {
    let connection = await this.trayConnectionRepository.findOne({
      where: { userId, shopUrl },
    });

    const expiresAt = new Date(Date.now() + 180 * 60 * 1000); // 180 minutos padrão

    if (connection) {
      connection.accessToken = authData.access_token;
      connection.refreshToken = authData.refresh_token;
      connection.apiUrl = authData.api_address;
      connection.tokenExpiresAt = expiresAt;
      connection.isActive = true;
      connection.lastSyncAt = new Date();
    } else {
      connection = this.trayConnectionRepository.create({
        userId,
        shopUrl,
        accessToken: authData.access_token,
        refreshToken: authData.refresh_token,
        apiUrl: authData.api_address,
        tokenExpiresAt: expiresAt,
        isActive: true,
        lastSyncAt: new Date(),
      });
    }

    return await this.trayConnectionRepository.save(connection);
  }

  /**
   * Faz uma requisição autenticada para a API da Tray
   */
  private async request(connection: TrayConnection, endpoint: string, options: any = {}): Promise<any> {
    // Verificar se o token expirou (margem de 5 minutos)
    const now = new Date();
    if (connection.tokenExpiresAt && connection.tokenExpiresAt.getTime() - now.getTime() < 5 * 60 * 1000) {
      connection = await this.refreshToken(connection.id);
    }

    const url = endpoint.startsWith('http') ? endpoint : `${connection.apiUrl}${endpoint}`;
    
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${connection.accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...options.headers,
      },
    });

    if (response.status === 401) {
      // Tentar renovar uma vez se der 401 inesperado
      connection = await this.refreshToken(connection.id);
      return this.request(connection, endpoint, options);
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      this.logger.error(`[Tray API Error] ${url} - Status: ${response.status} ${JSON.stringify(error)}`);
      throw new BadRequestException(error.message || `Erro na API da Tray: ${response.status}`);
    }

    return await response.json();
  }

  // --- MÉTODOS DE SINCRONIZAÇÃO (Esqueletos para implementação posterior) ---

  async syncProducts(userId: number): Promise<any> {
    const connection = await this.trayConnectionRepository.findOne({ where: { userId, isActive: true } });
    if (!connection) return { imported: 0 };
    
    // Implementar lógica similar ao NuvemshopService.syncProducts
    this.logger.log(`[Tray Sync] Sincronizando produtos para ${connection.shopUrl}...`);
    return { imported: 0 };
  }

  async syncOrders(userId: number): Promise<any> {
    const connection = await this.trayConnectionRepository.findOne({ where: { userId, isActive: true } });
    if (!connection) return { imported: 0 };

    this.logger.log(`[Tray Sync] Sincronizando pedidos para ${connection.shopUrl}...`);
    return { imported: 0 };
  }

  async syncCheckouts(userId: number): Promise<any> {
    const connection = await this.trayConnectionRepository.findOne({ where: { userId, isActive: true } });
    if (!connection) return { imported: 0 };

    this.logger.log(`[Tray Sync] Sincronizando carrinhos abandonados para ${connection.shopUrl}...`);
    return { imported: 0 };
  }

  async syncCustomers(userId: number): Promise<any> {
    const connection = await this.trayConnectionRepository.findOne({ where: { userId, isActive: true } });
    if (!connection) return { imported: 0 };

    this.logger.log(`[Tray Sync] Sincronizando clientes para ${connection.shopUrl}...`);
    return { imported: 0 };
  }
}
