import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

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
  private transporter: Transporter;

  constructor(private configService: ConfigService) {
    // Log para debug - verificar se as variáveis estão sendo lidas
    const smtpUser = this.configService.get<string>('SMTP_USER') || this.configService.get<string>('SMTP_USERNAME');
    const smtpPass = this.configService.get<string>('SMTP_PASS') || this.configService.get<string>('SMTP_PASSWORD');
    
    if (!smtpUser || !smtpPass) {
      this.logger.warn('⚠️ Credenciais SMTP não encontradas!');
      this.logger.warn('Verifique se o arquivo .env existe na raiz do backend e contém SMTP_USERNAME e SMTP_PASSWORD');
    } else {
      this.logger.log('✅ Credenciais SMTP carregadas com sucesso');
    }

    const smtpSecure = this.configService.get<string>('SMTP_SECURE');
    let secure = false;
    
    // Suporta 'tls', 'ssl', true, false
    if (smtpSecure === 'tls' || smtpSecure === 'ssl') {
      secure = smtpSecure === 'ssl'; // SSL usa secure=true, TLS usa secure=false
    } else {
      secure = this.configService.get<boolean>('SMTP_SECURE') || false;
    }

    this.transporter = nodemailer.createTransport({
      host: this.configService.get<string>('SMTP_HOST') || 'smtp.gmail.com',
      port: this.configService.get<number>('SMTP_PORT') || 587,
      secure: secure, // true para SSL (porta 465), false para TLS/STARTTLS (porta 587)
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });
  }

  async sendEmail(options: EmailOptions): Promise<void> {
    try {
      // Verificar se as credenciais SMTP estão configuradas
      const smtpUser = this.configService.get<string>('SMTP_USER') || this.configService.get<string>('SMTP_USERNAME');
      const smtpPass = this.configService.get<string>('SMTP_PASS') || this.configService.get<string>('SMTP_PASSWORD');
      
      if (!smtpUser || !smtpPass) {
        throw new Error('Credenciais SMTP não configuradas. Verifique as variáveis SMTP_USERNAME e SMTP_PASSWORD no arquivo .env');
      }

      const smtpFrom = this.configService.get<string>('SMTP_FROM');
      const smtpFromName = this.configService.get<string>('SMTP_FROM_NAME');
      const smtpFromEmail = this.configService.get<string>('SMTP_FROM_EMAIL');
      
      let from: string;
      if (smtpFrom) {
        from = smtpFrom;
      } else if (smtpFromName && smtpFromEmail) {
        from = `${smtpFromName} <${smtpFromEmail}>`;
      } else if (smtpFromEmail) {
        from = smtpFromEmail;
      } else {
        from = smtpUser || 'noreply@nucleocrm.com';
      }

      const mailOptions = {
        from: from,
        to: Array.isArray(options.to) ? options.to.join(', ') : options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
        cc: options.cc ? (Array.isArray(options.cc) ? options.cc.join(', ') : options.cc) : undefined,
        bcc: options.bcc ? (Array.isArray(options.bcc) ? options.bcc.join(', ') : options.bcc) : undefined,
        attachments: options.attachments,
      };

      const info = await this.transporter.sendMail(mailOptions);
      this.logger.log(`E-mail enviado com sucesso: ${info.messageId}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      const errorStack = error instanceof Error ? error.stack : undefined;
      
      this.logger.error(`Erro ao enviar e-mail: ${errorMessage}`, errorStack);
      
      // Melhorar mensagem de erro para problemas comuns
      if (errorMessage.includes('Invalid login') || errorMessage.includes('authentication failed') || errorMessage.includes('535')) {
        throw new Error('Credenciais SMTP inválidas. Verifique SMTP_USERNAME e SMTP_PASSWORD. Para Gmail, use uma Senha de App.');
      } else if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('ETIMEDOUT')) {
        throw new Error('Não foi possível conectar ao servidor SMTP. Verifique SMTP_HOST e SMTP_PORT.');
      } else if (errorMessage.includes('self signed certificate') || errorMessage.includes('UNABLE_TO_VERIFY_LEAF_SIGNATURE')) {
        throw new Error('Erro de certificado SSL. Verifique a configuração SMTP_SECURE.');
      } else if (errorMessage.includes('EAUTH')) {
        throw new Error('Falha na autenticação SMTP. Verifique as credenciais.');
      }
      
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
      await this.transporter.verify();
      this.logger.log('Conexão SMTP verificada com sucesso');
      return true;
    } catch (error) {
      this.logger.error(`Erro ao verificar conexão SMTP: ${error.message}`);
      return false;
    }
  }
}

