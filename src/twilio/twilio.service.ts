import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Twilio from 'twilio';
import * as crypto from 'crypto';

export interface TwilioCredentials {
    accountSid: string;
    authToken: string;
    whatsappFrom: string;
}

export interface TwilioSendOptions {
    statusCallback?: string;
}

@Injectable()
export class TwilioService {
    private readonly logger = new Logger(TwilioService.name);

    // Fallback global credentials from env (used when user has no subconta)
    private readonly globalAccountSid: string;
    private readonly globalAuthToken: string;
    private readonly globalWhatsappFrom: string;
    private readonly encryptionKey: Buffer | null;

    constructor(private configService: ConfigService) {
        this.globalAccountSid = this.configService.get<string>('TWILIO_ACCOUNT_SID', '');
        this.globalAuthToken = this.configService.get<string>('TWILIO_AUTH_TOKEN', '');
        this.globalWhatsappFrom = this.configService.get<string>('TWILIO_WHATSAPP_FROM', '');
        const encryptionKeyRaw = this.configService.get<string>('TWILIO_TOKEN_ENCRYPTION_KEY', '').trim();
        this.encryptionKey = encryptionKeyRaw
            ? crypto.createHash('sha256').update(encryptionKeyRaw).digest()
            : null;
    }

    getGlobalAuthToken(): string {
        return this.globalAuthToken;
    }

    encryptAuthToken(token: string): string {
        if (!token) return token;
        if (token.startsWith('enc:')) return token;
        if (!this.encryptionKey) return token;

        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
        const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
        const authTag = cipher.getAuthTag();
        return `enc:${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
    }

    decryptAuthToken(token: string | null | undefined): string {
        if (!token) return '';
        if (!token.startsWith('enc:')) return token;
        if (!this.encryptionKey) {
            this.logger.warn('TWILIO_TOKEN_ENCRYPTION_KEY não configurada para decriptar token.');
            return '';
        }

        try {
            const [, ivB64, tagB64, encryptedB64] = token.split(':');
            const iv = Buffer.from(ivB64, 'base64');
            const authTag = Buffer.from(tagB64, 'base64');
            const encrypted = Buffer.from(encryptedB64, 'base64');

            const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
            decipher.setAuthTag(authTag);
            const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
            return decrypted.toString('utf8');
        } catch (error: any) {
            this.logger.error(`Falha ao decriptar token Twilio: ${error.message}`);
            return '';
        }
    }

    /**
     * Formata o número de telefone para o padrão E.164.
     * Ex: 11999998888 → +5511999998888
     */
    private formatPhone(phone: string): string {
        let clean = phone.replace(/\D/g, '');
        if (!clean.startsWith('55')) {
            clean = '55' + clean;
        }
        return `+${clean}`;
    }

    /**
     * Retorna um cliente Twilio para as credenciais informadas.
     * Se não forem informadas, usa as variáveis de ambiente globais.
     */
    private getClient(credentials?: TwilioCredentials): Twilio.Twilio | null {
        const sid = credentials?.accountSid || this.globalAccountSid;
        const token = credentials?.authToken || this.globalAuthToken;

        if (!sid || !token) {
            this.logger.error('Twilio: Account SID ou Auth Token não configurados.');
            return null;
        }

        return Twilio.default(sid, token);
    }

    /**
     * Envia uma mensagem de WhatsApp usando um template aprovado (Content SID).
     * Obrigatório em produção para mensagens iniciadas pela empresa.
     *
     * @param to             Número E.164 do destinatário (sem whatsapp: prefix)
     * @param contentSid     Content SID do template aprovado (HXxxxxxxxx)
     * @param variables      Variáveis do template ex: { "1": "João", "2": "15/05/2026" }
     * @param credentials    Credenciais da subconta do usuário (opcional, usa ENV se omitido)
     */
    async sendWhatsAppTemplate(
        to: string,
        contentSid: string,
        variables: Record<string, string> = {},
        credentials?: TwilioCredentials,
        options?: TwilioSendOptions,
    ): Promise<boolean> {
        const client = this.getClient(credentials);
        if (!client) return false;

        const fromNumber = credentials?.whatsappFrom || this.globalWhatsappFrom;
        if (!fromNumber) {
            this.logger.error('Twilio: Número de WhatsApp de origem não configurado.');
            return false;
        }

        const toFormatted = this.formatPhone(to);

        try {
            this.logger.log(`[TWILIO] Enviando template ${contentSid} para ${toFormatted} (From: ${fromNumber})`);

            const messagePayload: any = {
                from: `whatsapp:${fromNumber}`,
                to: `whatsapp:${toFormatted}`,
                contentSid,
                statusCallback: options?.statusCallback,
            };

            if (variables && Object.keys(variables).length > 0) {
                messagePayload.contentVariables = JSON.stringify(variables);
            }

            this.logger.log(`[TWILIO PAYLOAD] ${JSON.stringify(messagePayload)}`);
            const message = await client.messages.create(messagePayload);

            this.logger.log(`[TWILIO SUCCESS] SID: ${message.sid} | Status: ${message.status}`);
            return true;
        } catch (error: any) {
            this.logger.error(`[TWILIO] Erro ao enviar template para ${toFormatted}: ${error.message}`);
            return false;
        }
    }

    /**
     * Envia uma mensagem de texto livre via WhatsApp.
     * Funciona apenas no Sandbox da Twilio ou com Approved Senders.
     * NÃO use em produção sem número aprovado.
     *
     * @param to             Número E.164 do destinatário
     * @param body           Corpo da mensagem em texto livre
     * @param credentials    Credenciais da subconta do usuário (opcional)
     */
    async sendWhatsAppText(
        to: string,
        body: string,
        credentials?: TwilioCredentials,
        options?: TwilioSendOptions,
    ): Promise<boolean> {
        const client = this.getClient(credentials);
        if (!client) return false;

        const fromNumber = credentials?.whatsappFrom || this.globalWhatsappFrom;
        if (!fromNumber) {
            this.logger.error('Twilio: Número de WhatsApp de origem não configurado.');
            return false;
        }

        const toFormatted = this.formatPhone(to);

        try {
            this.logger.log(`[TWILIO] Enviando texto livre para ${toFormatted} (From: ${fromNumber})`);

            const message = await client.messages.create({
                from: `whatsapp:${fromNumber}`,
                to: `whatsapp:${toFormatted}`,
                body,
                statusCallback: options?.statusCallback,
            });

            this.logger.log(`[TWILIO] Mensagem enviada com sucesso. SID: ${message.sid}`);
            return true;
        } catch (error: any) {
            this.logger.error(`[TWILIO] Erro ao enviar texto para ${toFormatted}: ${error.message}`);
            return false;
        }
    }

    /**
     * Cria uma subconta Twilio para um usuário.
     * Retorna o SID e o Auth Token da nova subconta.
     */
    async createSubaccount(friendlyName: string): Promise<{ sid: string; authToken: string } | null> {
        const client = this.getClient();
        if (!client) return null;

        try {
            this.logger.log(`[TWILIO] Criando subconta para: ${friendlyName}`);

            const subaccount = await client.api.v2010.accounts.create({
                friendlyName: `CRM: ${friendlyName}`,
            });

            this.logger.log(`[TWILIO] Subconta criada. SID: ${subaccount.sid}`);
            return {
                sid: subaccount.sid,
                authToken: subaccount.authToken,
            };
        } catch (error: any) {
            this.logger.error(`[TWILIO] Erro ao criar subconta para "${friendlyName}": ${error.message}`);
            return null;
        }
    }

    /**
     * Busca a lista de templates (Content API) disponíveis na conta/subconta.
     */
    async getTemplates(credentials?: TwilioCredentials): Promise<any[]> {
        const client = this.getClient(credentials);
        if (!client) return [];

        try {
            this.logger.log(`[TWILIO] Buscando templates do Content API...`);
            const contents = await client.content.v1.contents.list({ limit: 100 });
            return contents.map((c: any) => {
                this.logger.log(`[TWILIO TEMPLATE DEBUG] SID: ${c.sid} | Variables: ${JSON.stringify(c.variables)} | Types: ${JSON.stringify(c.types)}`);
                return {
                    sid: c.sid,
                    friendlyName: c.friendlyName,
                    variables: c.variables,
                    language: c.language,
                    types: c.types
                };
            });
        } catch (error: any) {
            this.logger.error(`[TWILIO] Erro ao listar templates: ${error.message}`);
            return [];
        }
    }
}
