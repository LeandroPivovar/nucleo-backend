import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { EmailConnection } from '../entities/email-connection.entity';

export interface SmtpEmailOptions {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  fromName?: string;
  fromEmail?: string;
}

@Injectable()
export class SmtpEmailService {
  private readonly logger = new Logger(SmtpEmailService.name);

  async sendEmail(connection: EmailConnection, options: SmtpEmailOptions): Promise<{ messageId: string }> {
    if (!connection.smtpHost || !connection.smtpPort || !connection.username || !connection.password) {
      throw new Error('Conexão SMTP incompleta. Verifique host, porta, usuário e senha.');
    }

    const fromName = options.fromName || 'Núcleo CRM';
    const fromEmail = options.fromEmail || connection.email || connection.username;
    const fromAddress = `"${fromName}" <${fromEmail}>`;

    const transporter = nodemailer.createTransport({
      host: connection.smtpHost,
      port: connection.smtpPort,
      secure: connection.secure,
      auth: {
        user: connection.username,
        pass: connection.password,
      },
    });

    try {
      const info = await transporter.sendMail({
        from: fromAddress,
        to: Array.isArray(options.to) ? options.to.join(', ') : options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
      });

      this.logger.log(`E-mail enviado via SMTP (${connection.smtpHost}): ID ${info.messageId}`);
      return { messageId: info.messageId };
    } catch (error: any) {
      this.logger.error(`Erro SMTP ${connection.smtpHost}:${connection.smtpPort} - ${error.message}`);
      throw new Error(`Falha no envio SMTP: ${error.message}`);
    }
  }
}
