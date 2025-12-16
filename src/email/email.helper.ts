import { Injectable } from '@nestjs/common';
import { EmailService, EmailOptions } from './email.service';

/**
 * Helper para facilitar o envio de e-mails
 * 
 * Exemplo de uso:
 * ```typescript
 * constructor(private emailHelper: EmailHelper) {}
 * 
 * await this.emailHelper.send({
 *   to: 'usuario@email.com',
 *   subject: 'Assunto do e-mail',
 *   html: '<h1>Conteúdo HTML</h1>',
 * });
 * ```
 */
@Injectable()
export class EmailHelper {
  constructor(private emailService: EmailService) {}

  /**
   * Envia um e-mail genérico
   */
  async send(options: EmailOptions): Promise<void> {
    return this.emailService.sendEmail(options);
  }

  /**
   * Envia e-mail de boas-vindas
   */
  async sendWelcome(to: string, name: string): Promise<void> {
    return this.emailService.sendWelcomeEmail(to, name);
  }

  /**
   * Envia e-mail de redefinição de senha
   */
  async sendPasswordReset(to: string, resetToken: string): Promise<void> {
    return this.emailService.sendPasswordResetEmail(to, resetToken);
  }

  /**
   * Envia e-mail com código de recuperação de senha
   */
  async sendPasswordResetCode(to: string, code: string, name?: string): Promise<void> {
    return this.emailService.sendPasswordResetCodeEmail(to, code, name);
  }

  /**
   * Envia e-mail de verificação de conta
   */
  async sendEmailVerification(to: string, token: string, name?: string): Promise<void> {
    return this.emailService.sendEmailVerificationEmail(to, token, name);
  }

  /**
   * Verifica a conexão SMTP
   */
  async verifyConnection(): Promise<boolean> {
    return this.emailService.verifyConnection();
  }
}

