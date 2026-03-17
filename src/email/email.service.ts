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
    const fromName = 'Núcleo CRM';

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
      if (options.attachments && options.attachments.length > 0) {
        const validAttachments = options.attachments.filter(a => !!a.path);
        const backendUrl = this.configService.get<string>('BACKEND_URL', 'http://localhost:3000');

        if (validAttachments.length > 0) {
          attachmentsUrl = validAttachments.map(a => {
            let fileUrl = a.path as string;
            if (fileUrl.startsWith('/api')) {
              fileUrl = `${backendUrl}${fileUrl}`;
            }
            return {
              fileUrl,
              fileName: a.filename
            };
          });
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
    const year = new Date().getFullYear();
    const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'https://nucleo.com.br';
    const supportEmail = 'contato@nucleocrm.com.br';

    const html = `
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
        <style>
          body { margin: 0; padding: 0; background-color: #f4f2f8; font-family: Arial, Helvetica, sans-serif; color: #1f2937; }
          table { border-collapse: collapse; }
          .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; }
          .header { background: linear-gradient(135deg, #6d28d9, #8b5cf6); padding: 32px; text-align: center; }
          .logo { max-width: 180px; }
          .content { padding: 32px; }
          .title { font-size: 24px; font-weight: bold; margin-bottom: 12px; }
          .text { font-size: 15px; line-height: 1.6; margin-bottom: 20px; color: #374151; }
          .code-box { background: #f9fafb; border: 2px dashed #6d28d9; border-radius: 10px; padding: 24px; text-align: center; margin: 24px 0; }
          .code { font-size: 32px; font-weight: bold; color: #6d28d9; letter-spacing: 8px; font-family: 'Courier New', monospace; }
          .footer { padding: 24px; font-size: 12px; color: #6b7280; text-align: center; }
          .footer a { color: #6d28d9; text-decoration: none; }
        </style>
      </head>
      <body>
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td align="center" style="padding: 24px;">
              <table class="container" width="100%">
                <tr>
                  <td class="header">
                    <img src="${frontendUrl}/nucleo-logo.png" alt="Núcleo CRM" class="logo" />
                  </td>
                </tr>
                <tr>
                  <td class="content">
                    <div class="title">Recuperação de Senha</div>
                    <p class="text">Olá, <strong>${name || 'Usuário'}</strong> 👋</p>
                    <p class="text">Você solicitou a recuperação de senha da sua conta na <strong>Núcleo CRM</strong>. Use o código abaixo para continuar:</p>
                    <div class="code-box">
                      <div class="code">${code}</div>
                    </div>
                    <p class="text" style="font-size:13px;color:#6b7280;">Este código é válido por <strong>15 minutos</strong>. Se você não solicitou esta recuperação, ignore este e-mail.</p>
                  </td>
                </tr>
                <tr>
                  <td class="footer">
                    ©️ ${year} Núcleo CRM<br/>
                    <a href="${frontendUrl}">${frontendUrl}</a> · 
                    <a href="mailto:${supportEmail}">${supportEmail}</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `;

    await this.sendEmail({
      to,
      subject: 'Código de Recuperação de Senha - Núcleo CRM',
      html,
    });
  }

  async sendEmailVerificationEmail(to: string, token: string, name?: string): Promise<void> {
    const year = new Date().getFullYear();
    const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'https://nucleo.com.br';
    const baseUrl = frontendUrl.includes('localhost') ? frontendUrl : 'https://nucleo.com.br';
    const verificationUrl = `${baseUrl}/auth/verify-email?token=${token}`;
    const supportEmail = 'contato@nucleocrm.com.br';

    const html = `
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
        <style>
          body { margin: 0; padding: 0; background-color: #f4f2f8; font-family: Arial, Helvetica, sans-serif; color: #1f2937; }
          table { border-collapse: collapse; }
          .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; }
          .header { background: linear-gradient(135deg, #6d28d9, #8b5cf6); padding: 32px; text-align: center; }
          .logo { max-width: 180px; }
          .content { padding: 32px; }
          .title { font-size: 24px; font-weight: bold; margin-bottom: 12px; }
          .text { font-size: 15px; line-height: 1.6; margin-bottom: 20px; color: #374151; }
          .button { display: inline-block; background-color: #6d28d9; color: #ffffff !important; text-decoration: none; padding: 14px 24px; border-radius: 10px; font-weight: bold; font-size: 15px; }
          .link-box { background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px; font-size: 12px; word-break: break-all; color: #111827; }
          .footer { padding: 24px; font-size: 12px; color: #6b7280; text-align: center; }
          .footer a { color: #6d28d9; text-decoration: none; }
        </style>
      </head>
      <body>
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td align="center" style="padding: 24px;">
              <table class="container" width="100%">
                <tr>
                  <td class="header">
                    <img src="${frontendUrl}/nucleo-logo.png" alt="Núcleo CRM" class="logo" />
                  </td>
                </tr>
                <tr>
                  <td class="content">
                    <div class="title">Verifique seu e-mail</div>
                    <p class="text">Olá, <strong>${name || 'Usuário'}</strong> 👋</p>
                    <p class="text">Obrigado por se cadastrar na <strong>Núcleo CRM</strong>. Para ativar sua conta e começar a usar a plataforma, confirme seu e-mail clicando no botão abaixo:</p>
                    <p style="text-align:center; margin: 32px 0;">
                      <a href="${verificationUrl}" class="button" target="_blank">Verificar e ativar minha conta</a>
                    </p>
                    <p class="text" style="font-size:13px;color:#6b7280;">Este link expira em <strong>24 horas</strong>. Se você não solicitou este cadastro, basta ignorar este e-mail.</p>
                    <p class="text" style="font-size:13px;color:#6b7280;">Caso o botão não funcione, copie e cole o link abaixo no seu navegador:</p>
                    <div class="link-box">${verificationUrl}</div>
                  </td>
                </tr>
                <tr>
                  <td class="footer">
                    ©️ ${year} Núcleo CRM<br/>
                    <a href="${frontendUrl}">${frontendUrl}</a> · 
                    <a href="mailto:${supportEmail}">${supportEmail}</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `;

    await this.sendEmail({
      to,
      subject: 'Verifique seu e-mail e ative sua conta - Núcleo CRM',
      html,
    });
  }

  async sendTwoFactorCodeEmail(to: string, code: string, name?: string): Promise<void> {
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
              <h1>Autenticação de Dois Fatores</h1>
            </div>
            <div class="content">
              <p>Olá${name ? `, ${name}` : ''}!</p>
              <p>Para prosseguir com seu login no Núcleo CRM, utilize o código de segurança abaixo:</p>
              <div class="code-box">
                <div class="code">${code}</div>
              </div>
              <p class="info">Este código é válido por 10 minutos.</p>
              <p class="warning">Se você não tentou fazer login na sua conta, recomendamos que altere sua senha imediatamente.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    await this.sendEmail({
      to,
      subject: 'Seu Código de Segurança - Núcleo CRM',
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

