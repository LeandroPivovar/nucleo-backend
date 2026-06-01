import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { BotFlow } from '../entities/bot-flow.entity';
import { BotTelegramConnection } from '../entities/bot-telegram-connection.entity';
import { TelegramApiService, type TelegramUpdate } from '../telegram/telegram-api.service';
import { TelegramTokenCrypto } from '../telegram/telegram-token.crypto';

export interface TelegramConnectionStatusDto {
  connected: boolean;
  status: string | null;
  botUsername: string | null;
  connectedAt: string | null;
}

@Injectable()
export class BotTelegramService {
  private readonly logger = new Logger(BotTelegramService.name);

  constructor(
    @InjectRepository(BotFlow)
    private readonly botFlowRepository: Repository<BotFlow>,
    @InjectRepository(BotTelegramConnection)
    private readonly connectionRepository: Repository<BotTelegramConnection>,
    private readonly telegramApi: TelegramApiService,
    private readonly tokenCrypto: TelegramTokenCrypto,
    private readonly configService: ConfigService,
  ) {}

  private getWebhookBaseUrl(): string {
    const base = this.configService.get<string>('BACKEND_URL', 'http://localhost:3000').trim();
    return base.replace(/\/$/, '');
  }

  private buildWebhookUrl(botFlowId: number): string {
    return `${this.getWebhookBaseUrl()}/api/bot-flows/webhook/telegram/${botFlowId}`;
  }

  private async findFlowForUser(userId: number, botFlowId: number): Promise<BotFlow> {
    const flow = await this.botFlowRepository.findOne({
      where: { id: botFlowId, userId },
    });
    if (!flow) {
      throw new NotFoundException(`Fluxo com ID ${botFlowId} não encontrado`);
    }
    if (flow.channel !== 'telegram') {
      throw new BadRequestException('Este fluxo não é do canal Telegram');
    }
    return flow;
  }

  async getStatus(userId: number, botFlowId: number): Promise<TelegramConnectionStatusDto> {
    await this.findFlowForUser(userId, botFlowId);
    const conn = await this.connectionRepository.findOne({
      where: { botFlowId },
    });

    if (!conn || conn.status !== 'connected') {
      return {
        connected: false,
        status: conn?.status ?? null,
        botUsername: conn?.botUsername ?? null,
        connectedAt: conn?.connectedAt?.toISOString() ?? null,
      };
    }

    return {
      connected: true,
      status: conn.status,
      botUsername: conn.botUsername,
      connectedAt: conn.connectedAt?.toISOString() ?? null,
    };
  }

  async connect(userId: number, botFlowId: number, rawToken: string) {
    const flow = await this.findFlowForUser(userId, botFlowId);
    const botToken = rawToken.trim();

    if (!/^\d+:[A-Za-z0-9_-]+$/.test(botToken)) {
      throw new BadRequestException(
        'Token inválido. Copie o token completo do @BotFather (formato 123456789:ABC...).',
      );
    }

    let botInfo;
    try {
      botInfo = await this.telegramApi.getMe(botToken);
    } catch {
      throw new BadRequestException('Não foi possível validar o token com a API do Telegram.');
    }

    const telegramBotId = String(botInfo.id);
    const existingForOtherFlow = await this.connectionRepository.findOne({
      where: { telegramBotId },
    });
    if (existingForOtherFlow && existingForOtherFlow.botFlowId !== botFlowId) {
      throw new ConflictException(
        'Este bot já está conectado a outro fluxo. Use outro bot ou desconecte o fluxo anterior.',
      );
    }

    const webhookSecret = crypto.randomBytes(32).toString('hex');
    const webhookUrl = this.buildWebhookUrl(botFlowId);

    try {
      await this.telegramApi.setWebhook(botToken, webhookUrl, webhookSecret);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new BadRequestException(
        `Falha ao registrar webhook no Telegram. Verifique se BACKEND_URL é HTTPS público. (${message})`,
      );
    }

    const encryptedToken = this.tokenCrypto.encrypt(botToken);
    let conn = await this.connectionRepository.findOne({ where: { botFlowId } });

    if (conn) {
      conn.botToken = encryptedToken;
      conn.telegramBotId = telegramBotId;
      conn.botUsername = botInfo.username ?? null;
      conn.webhookSecret = webhookSecret;
      conn.status = 'connected';
      conn.connectedAt = new Date();
      conn.userId = userId;
    } else {
      conn = this.connectionRepository.create({
        botFlowId: flow.id,
        userId,
        botToken: encryptedToken,
        telegramBotId,
        botUsername: botInfo.username ?? null,
        webhookSecret,
        status: 'connected',
        connectedAt: new Date(),
      });
    }

    await this.connectionRepository.save(conn);

    this.logger.log(
      `Telegram conectado: fluxo=${botFlowId}, bot=@${botInfo.username ?? telegramBotId}`,
    );

    return {
      success: true,
      botUsername: conn.botUsername,
      connectedAt: conn.connectedAt?.toISOString(),
    };
  }

  async disconnect(userId: number, botFlowId: number) {
    await this.findFlowForUser(userId, botFlowId);
    const conn = await this.connectionRepository.findOne({
      where: { botFlowId },
      select: ['id', 'botToken', 'botFlowId'],
    });

    if (!conn) {
      return { success: true };
    }

    const botToken = this.tokenCrypto.decrypt(conn.botToken);
    if (botToken) {
      try {
        await this.telegramApi.deleteWebhook(botToken);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`deleteWebhook falhou (fluxo ${botFlowId}): ${message}`);
      }
    }

    await this.connectionRepository.remove(conn);
    return { success: true };
  }

  async handleWebhook(
    botFlowId: number,
    secretToken: string | undefined,
    update: TelegramUpdate,
  ): Promise<void> {
    const conn = await this.connectionRepository.findOne({
      where: { botFlowId, status: 'connected' },
      select: ['id', 'botToken', 'webhookSecret', 'botFlowId'],
    });

    if (!conn) {
      throw new NotFoundException('Conexão Telegram não encontrada');
    }

    if (!secretToken || secretToken !== conn.webhookSecret) {
      throw new UnauthorizedException('Secret token inválido');
    }

    const message = update?.message;
    if (!message?.chat?.id) {
      return;
    }

    const botToken = this.tokenCrypto.decrypt(conn.botToken);
    if (!botToken) {
      this.logger.error(`Token Telegram ausente para fluxo ${botFlowId}`);
      return;
    }

    const replyText = this.buildEchoReply(message.text, message.caption);
    if (!replyText) {
      return;
    }

    await this.telegramApi.sendMessage(botToken, message.chat.id, replyText);
  }

  private buildEchoReply(text?: string, caption?: string): string | null {
    const content = (text ?? caption ?? '').trim();
    if (!content) {
      return 'Recebi sua mensagem. Por enquanto só consigo repetir mensagens de texto.';
    }
    return content;
  }
}
