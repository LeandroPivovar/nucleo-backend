import { Injectable, Logger } from '@nestjs/common';

export interface TelegramBotInfo {
  id: number;
  username?: string;
  first_name?: string;
}

export interface TelegramMessage {
  message_id: number;
  chat: { id: number; type: string };
  text?: string;
  caption?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

@Injectable()
export class TelegramApiService {
  private readonly logger = new Logger(TelegramApiService.name);
  private readonly apiBase = 'https://api.telegram.org';

  private async request<T>(
    botToken: string,
    method: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const url = `${this.apiBase}/bot${botToken}/${method}`;
    const init: RequestInit = body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      : { method: 'GET' };

    const res = await fetch(url, init);
    const data = (await res.json()) as TelegramApiResponse<T>;

    if (!data.ok) {
      const desc = data.description || `HTTP ${res.status}`;
      this.logger.warn(`Telegram API ${method} falhou: ${desc}`);
      throw new Error(desc);
    }

    return data.result as T;
  }

  async getMe(botToken: string): Promise<TelegramBotInfo> {
    return this.request<TelegramBotInfo>(botToken, 'getMe');
  }

  async setWebhook(
    botToken: string,
    webhookUrl: string,
    secretToken: string,
  ): Promise<boolean> {
    await this.request(botToken, 'setWebhook', {
      url: webhookUrl,
      secret_token: secretToken,
      allowed_updates: ['message'],
      drop_pending_updates: true,
    });
    return true;
  }

  async deleteWebhook(botToken: string): Promise<void> {
    await this.request(botToken, 'deleteWebhook', { drop_pending_updates: true });
  }

  async sendMessage(botToken: string, chatId: number, text: string): Promise<void> {
    await this.request(botToken, 'sendMessage', {
      chat_id: chatId,
      text,
    });
  }

  async sendPhoto(botToken: string, chatId: number, photoUrl: string, caption?: string): Promise<void> {
    await this.request(botToken, 'sendPhoto', {
      chat_id: chatId,
      photo: photoUrl,
      caption: caption || undefined,
    });
  }
}
