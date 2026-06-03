import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as QRCode from 'qrcode';
import { makeWASocket, DisconnectReason, WASocket } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { BotFlow } from '../entities/bot-flow.entity';
import { BotWhatsappConnection } from '../entities/bot-whatsapp-connection.entity';
import { BotWhatsappSession } from '../entities/bot-whatsapp-session.entity';
import { BotFlowExecutorService } from './bot-flow-executor.service';
import { useTypeORMAuthState } from './whatsapp-auth';

export interface WhatsappConnectionStatusDto {
  connected: boolean;
  status: string | null;
  botPhoneNumber: string | null;
  connectedAt: string | null;
  qrCode: string | null;
}

@Injectable()
export class BotWhatsappService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BotWhatsappService.name);
  
  // Client manager to hold all active WhatsApp connections
  private readonly clients = new Map<number, WASocket>();

  constructor(
    @InjectRepository(BotFlow)
    private readonly botFlowRepository: Repository<BotFlow>,
    @InjectRepository(BotWhatsappConnection)
    private readonly connectionRepository: Repository<BotWhatsappConnection>,
    @InjectRepository(BotWhatsappSession)
    private readonly sessionRepository: Repository<BotWhatsappSession>,
    private readonly flowExecutor: BotFlowExecutorService,
  ) {}

  async onApplicationBootstrap() {
    this.logger.log('Inicializando conexões WhatsApp salvas...');
    const connections = await this.connectionRepository.find({
      where: { status: 'connected' },
    });
    
    for (const conn of connections) {
      try {
        await this.startWhatsapp(conn.botFlowId);
      } catch (err) {
        this.logger.error(`Erro ao iniciar WhatsApp para fluxo ${conn.botFlowId}`, err);
      }
    }
  }

  private async findFlowForUser(userId: number, botFlowId: number): Promise<BotFlow> {
    const flow = await this.botFlowRepository.findOne({
      where: { id: botFlowId, userId },
    });
    if (!flow) {
      throw new NotFoundException(`Fluxo com ID ${botFlowId} não encontrado`);
    }
    if (flow.channel !== 'whatsapp_qr') {
      throw new BadRequestException('Este fluxo não é do canal WhatsApp QR');
    }
    return flow;
  }

  async getStatus(userId: number, botFlowId: number): Promise<WhatsappConnectionStatusDto> {
    await this.findFlowForUser(userId, botFlowId);
    const conn = await this.connectionRepository.findOne({
      where: { botFlowId },
    });

    if (!conn) {
      return {
        connected: false,
        status: 'disconnected',
        botPhoneNumber: null,
        connectedAt: null,
        qrCode: null,
      };
    }

    return {
      connected: conn.status === 'connected',
      status: conn.status,
      botPhoneNumber: conn.botPhoneNumber,
      connectedAt: conn.connectedAt?.toISOString() ?? null,
      qrCode: conn.qrCode,
    };
  }

  async connect(userId: number, botFlowId: number) {
    const flow = await this.findFlowForUser(userId, botFlowId);
    
    let conn = await this.connectionRepository.findOne({ where: { botFlowId } });
    if (!conn) {
      conn = this.connectionRepository.create({
        botFlowId: flow.id,
        userId,
        status: 'connecting',
      });
    } else {
      conn.status = 'connecting';
      conn.qrCode = null;
    }
    await this.connectionRepository.save(conn);

    // Start background process
    this.startWhatsapp(botFlowId).catch(err => {
      this.logger.error(`Erro ao iniciar processo WhatsApp: ${err.message}`);
    });

    return { success: true, status: 'connecting' };
  }

  async disconnect(userId: number, botFlowId: number) {
    await this.findFlowForUser(userId, botFlowId);
    
    const socket = this.clients.get(botFlowId);
    if (socket) {
      socket.logout(); // This terminates the session on WhatsApp's side as well
      this.clients.delete(botFlowId);
    }
    
    // Clear sessions
    const sessions = await this.sessionRepository
      .createQueryBuilder()
      .where("sessionId LIKE :pattern", { pattern: `${botFlowId}_%` })
      .getMany();
    if (sessions.length > 0) {
      await this.sessionRepository.remove(sessions);
    }

    // Update connection status
    const conn = await this.connectionRepository.findOne({ where: { botFlowId } });
    if (conn) {
      conn.status = 'disconnected';
      conn.qrCode = null;
      conn.botPhoneNumber = null;
      await this.connectionRepository.save(conn);
    }

    return { success: true };
  }

  private async startWhatsapp(botFlowId: number) {
    // If already running, ignore
    if (this.clients.has(botFlowId)) {
      this.logger.log(`WhatsApp do fluxo ${botFlowId} já está rodando.`);
      return;
    }

    const { state, saveCreds } = await useTypeORMAuthState(botFlowId, this.sessionRepository);

    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      browser: ['Nucleo CRM', 'Desktop', '1.0.0'],
    });

    this.clients.set(botFlowId, sock);

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      
      let conn = await this.connectionRepository.findOne({ where: { botFlowId } });
      if (!conn) return;

      if (qr) {
        try {
          const qrCodeDataUrl = await QRCode.toDataURL(qr);
          conn.qrCode = qrCodeDataUrl;
          conn.status = 'qr_ready';
          await this.connectionRepository.save(conn);
        } catch (e) {
          this.logger.error('Erro ao gerar QR code', e);
        }
      }

      if (connection === 'close') {
        const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
        this.logger.log(`Conexão fechada. Reconectar? ${shouldReconnect}`);
        
        this.clients.delete(botFlowId);
        
        if (shouldReconnect) {
          setTimeout(() => this.startWhatsapp(botFlowId), 5000);
        } else {
          conn.status = 'disconnected';
          conn.qrCode = null;
          conn.botPhoneNumber = null;
          await this.connectionRepository.save(conn);
        }
      } else if (connection === 'open') {
        this.logger.log(`WhatsApp conectado para fluxo ${botFlowId}`);
        conn.status = 'connected';
        conn.qrCode = null;
        conn.connectedAt = new Date();
        conn.botPhoneNumber = sock.user?.id.split(':')[0] || null;
        await this.connectionRepository.save(conn);
        
        // Ativar o fluxo se não estiver ativo
        const flow = await this.botFlowRepository.findOne({ where: { id: botFlowId } });
        if (flow && !flow.isActive) {
            flow.isActive = true;
            await this.botFlowRepository.save(flow);
        }
      }
    });

    sock.ev.on('messages.upsert', async (m) => {
      if (m.type !== 'notify') return;
      
      for (const msg of m.messages) {
        if (!msg.message || msg.key.fromMe) continue;

        const remoteJid = msg.key.remoteJid;
        if (!remoteJid || remoteJid === 'status@broadcast') continue;

        // Extrai texto da mensagem (pode ser conversation ou extendedTextMessage)
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
        if (!text.trim()) continue;

        try {
          const flow = await this.botFlowRepository.findOne({ where: { id: botFlowId } });
          if (!flow) return;

          // Contact ID: only phone number part, or jid
          const contactId = remoteJid;

          const outputs = await this.flowExecutor.processMessage(flow, contactId, text);
          
          for (const output of outputs) {
            if (output.type === 'photo' && output.photoUrl) {
              await sock.sendMessage(remoteJid, { 
                image: { url: output.photoUrl }, 
                caption: output.text 
              });
            } else if (output.text) {
              await sock.sendMessage(remoteJid, { text: output.text });
            }
          }
        } catch (error) {
          this.logger.error(`Erro ao processar mensagem WhatsApp (fluxo ${botFlowId})`, error);
        }
      }
    });
  }
}
