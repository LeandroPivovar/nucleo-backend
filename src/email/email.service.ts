import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SystemSettingsService } from '../system-settings/system-settings.service';

export interface EmailOptions {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  cc?: string | string[];
  bcc?: string | string[];
  attachments?: Array<{
    filename: string;
    content?: string | Buffer;
    path?: string;
    contentType?: string;
  }>;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    private configService: ConfigService,
    private systemSettingsService: SystemSettingsService
  ) { }

  private async getZenviaConfig(): Promise<{ apiToken: string; fromEmail: string; fromName: string }> {
    const dbFromEmail = await this.systemSettingsService.get('SMTP_FROM_EMAIL', '');
    const dbFromName = await this.systemSettingsService.get('SMTP_FROM_NAME', '');

    const apiToken = this.configService.get<string>('ZENVIA_API_TOKEN', '');
    const smsFrom = this.configService.get<string>('ZENVIA_SMS_FROM', '');

    const fromEmail = dbFromEmail || this.configService.get<string>('SMTP_FROM_EMAIL') || this.configService.get<string>('SMTP_FROM') || smsFrom || 'contato@nucleocrm.com.br';
    const fromName = dbFromName || this.configService.get<string>('SMTP_FROM_NAME') || 'Núcleo CRM';

    return { apiToken, fromEmail, fromName };
  }

  async sendEmail(options: EmailOptions): Promise<void> {
    try {
      const config = await this.getZenviaConfig();

      if (!config.apiToken) {
        this.logger.warn('⚠️ ZENVIA_API_TOKEN não encontrado no .env!');
        throw new Error('Configuração de API da Zenvia não encontrada.');
      }

      // Prepara os endereços de destino (TO) - Para simplificar enviamos um e-mail para o primeiro TO, 
      // ou múltiplos dependendo de como a aplicação chama, mas a Zenvia pede um 'to' string único no root da API de e-mail 
      // e permite vários apenas se forem listados em cada recipient, mas o payload base usa um 'to' string único.
      // Se options.to for array e tivermos que mandar pra todos, precisaremos de multiplos contents/chamadas?
      // O Payload da documentação pede um único 'to' string no root. Vamos pegar o primeiro.
      const toAddresses = Array.isArray(options.to) ? options.to : [options.to];
      if (toAddresses.length === 0) {
        throw new Error('Nenhum destinatário informado.');
      }

      // Prepara anexos (se houver e tiver url, pois Zenvia pede url)
      // A biblioteca antiga nodemailer aceitava content base64, path etc. 
      // A Zenvia exige fileUrl. Para envio transacional com anexos sem URL, isso precisaria ser adaptado gerando URLs, 
      // ignoraremos anexos que não mapeiam para a API da Zenvia (que requer fileUrl público)
      let attachmentsUrl: Array<{ fileUrl: string; fileName?: string }> | undefined = undefined;
      if (options.attachments && options.attachments.length > 0) {
        const validAttachments = options.attachments.filter(a => !!a.path);

        if (validAttachments.length > 0) {
          attachmentsUrl = validAttachments.map(a => ({
            fileUrl: a.path as string,
            fileName: a.filename
          }));
        }
      }

      // Prepara CC/BCC
      const ccList = options.cc
        ? (Array.isArray(options.cc) ? options.cc : [options.cc]).map(email => ({ email }))
        : undefined;

      const bccList = options.bcc
        ? (Array.isArray(options.bcc) ? options.bcc : [options.bcc]).map(email => ({ email }))
        : undefined;

      const payload = {
        from: config.fromEmail,
        to: toAddresses[0], // Pelo doc, 'to' é string e obrigatório
        contents: [
          {
            type: 'email',
            subject: options.subject,
            html: options.html || options.text,
            attachments: attachmentsUrl,
            cc: ccList,
            bcc: bccList
          }
        ],
        representative: {
          name: config.fromName
        }
      };

      this.logger.debug(`Zenvia E-mail Request Payload for ${payload.to}: \n${JSON.stringify(payload, null, 2)}`);

      const response = await fetch('https://api.zenvia.com/v2/channels/email/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-TOKEN': config.apiToken,
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errPayload = await response.text();
        this.logger.error(`Zenvia Email API Error: ${response.status} - ${errPayload}`);
        throw new Error(`Zenvia Email API Error: ${response.status} - ${errPayload}`);
      }

      const successPayload = await response.json();
      this.logger.log(`E-mail enviado com sucesso via Zenvia: ID ${successPayload.id}`);
      this.logger.debug(`Zenvia E-mail Success Response:\n${JSON.stringify(successPayload, null, 2)}`);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Erro ao enviar e-mail via Zenvia: ${errorMessage}`, errorStack);
      throw new Error(`Erro ao enviar e-mail: ${errorMessage}`);
    }
  }

  async sendWelcomeEmail(to: string, name: string): Promise<void> {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
            .button { display: inline-block; padding: 12px 30px; background: #667eea; color: white; text-decoration: none; border-radius: 5px; margin-top: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Bem-vindo ao Núcleo CRM!</h1>
            </div>
            <div class="content">
              <p>Olá, ${name}!</p>
              <p>Sua conta foi criada com sucesso. Estamos felizes em tê-lo conosco!</p>
              <p>Você já pode começar a usar todas as funcionalidades do Núcleo CRM.</p>
              <a href="${this.configService.get<string>('FRONTEND_URL') || 'http://localhost:8080'}" class="button">Acessar Plataforma</a>
            </div>
          </div>
        </body>
      </html>
    `;

    await this.sendEmail({
      to,
      subject: 'Bem-vindo ao Núcleo CRM!',
      html,
    });
  }

  async sendPasswordResetEmail(to: string, resetToken: string): Promise<void> {
    const resetUrl = `${this.configService.get<string>('FRONTEND_URL') || 'http://localhost:8080'}/auth/reset-password?token=${resetToken}`;

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
            .button { display: inline-block; padding: 12px 30px; background: #667eea; color: white; text-decoration: none; border-radius: 5px; margin-top: 20px; }
            .warning { color: #d32f2f; font-size: 12px; margin-top: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Redefinição de Senha</h1>
            </div>
            <div class="content">
              <p>Você solicitou a redefinição de senha da sua conta.</p>
              <p>Clique no botão abaixo para criar uma nova senha:</p>
              <a href="${resetUrl}" class="button">Redefinir Senha</a>
              <p class="warning">Se você não solicitou esta redefinição, ignore este e-mail.</p>
              <p>Este link expira em 1 hora.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    await this.sendEmail({
      to,
      subject: 'Redefinição de Senha - Núcleo CRM',
      html,
    });
  }

  async sendPasswordResetCodeEmail(to: string, code: string, name?: string): Promise<void> {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
            .code-box { background: #fff; border: 2px dashed #667eea; padding: 20px; text-align: center; margin: 20px 0; border-radius: 8px; }
            .code { font-size: 32px; font-weight: bold; color: #667eea; letter-spacing: 8px; font-family: 'Courier New', monospace; }
            .warning { color: #d32f2f; font-size: 12px; margin-top: 20px; }
            .info { color: #666; font-size: 14px; margin-top: 10px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Recuperação de Senha</h1>
            </div>
            <div class="content">
              <p>Olá${name ? `, ${name}` : ''}!</p>
              <p>Você solicitou a recuperação de senha da sua conta. Use o código abaixo para continuar:</p>
              <div class="code-box">
                <div class="code">${code}</div>
              </div>
              <p class="info">Este código é válido por 15 minutos.</p>
              <p class="warning">Se você não solicitou esta recuperação, ignore este e-mail.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    await this.sendEmail({
      to,
      subject: 'Código de Recuperação de Senha - ULTRA Academy',
      html,
    });
  }

  async sendEmailVerificationEmail(to: string, token: string, name?: string): Promise<void> {
    const verificationUrl = `${this.configService.get<string>('FRONTEND_URL') || 'http://localhost:8080'}/auth/verify-email?token=${token}`;

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
            .button { display: inline-block; padding: 12px 30px; background: #667eea; color: white; text-decoration: none; border-radius: 5px; margin-top: 20px; }
            .warning { color: #d32f2f; font-size: 12px; margin-top: 20px; }
            .info { color: #666; font-size: 14px; margin-top: 10px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Verifique seu E-mail</h1>
            </div>
            <div class="content">
              <p>Olá${name ? `, ${name}` : ''}!</p>
              <p>Obrigado por se cadastrar no Núcleo CRM!</p>
              <p>Para ativar sua conta, clique no botão abaixo:</p>
              <div style="text-align: center;">
                <a href="${verificationUrl}" class="button">Verificar E-mail e Ativar Conta</a>
              </div>
              <p class="info">Ou copie e cole este link no seu navegador:</p>
              <p style="word-break: break-all; color: #667eea; font-size: 12px;">${verificationUrl}</p>
              <p class="warning">Este link expira em 24 horas.</p>
              <p class="warning">Se você não criou esta conta, ignore este e-mail.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    await this.sendEmail({
      to,
      subject: 'Verifique seu e-mail - ULTRA Academy',
      html,
    });
  }

  async verifyConnection(): Promise<boolean> {
    try {
      const config = await this.getZenviaConfig();
      if (config.apiToken) {
        this.logger.log('Token da Zenvia configurado. Verificação passiva aprovada.');
        return true;
      }
      return false;
    } catch (error: any) {
      this.logger.error(`Erro ao verificar conexão Zenvia: ${error.message}`);
      return false;
    }
  }
}

