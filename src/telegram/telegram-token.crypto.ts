import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class TelegramTokenCrypto {
  private readonly logger = new Logger(TelegramTokenCrypto.name);
  private readonly encryptionKey: Buffer | null;

  constructor(private readonly configService: ConfigService) {
    const raw =
      this.configService.get<string>('TELEGRAM_TOKEN_ENCRYPTION_KEY', '').trim() ||
      this.configService.get<string>('TWILIO_TOKEN_ENCRYPTION_KEY', '').trim();
    this.encryptionKey = raw ? crypto.createHash('sha256').update(raw).digest() : null;
  }

  encrypt(token: string): string {
    if (!token) return token;
    if (token.startsWith('enc:')) return token;
    if (!this.encryptionKey) return token;

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `enc:${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
  }

  decrypt(token: string | null | undefined): string {
    if (!token) return '';
    if (!token.startsWith('enc:')) return token;
    if (!this.encryptionKey) {
      this.logger.warn('TELEGRAM_TOKEN_ENCRYPTION_KEY não configurada para decriptar token.');
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
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Falha ao decriptar token Telegram: ${message}`);
      return '';
    }
  }
}
