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
import * as crypto from 'crypto';

@Injectable()
export class VtexService {
  private readonly encryptionKey: string;

  constructor(
    @InjectRepository(VtexConnection)
    private vtexConnectionRepository: Repository<VtexConnection>,
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
    return `https://${accountName}.myvtex.com`;
  }
}

