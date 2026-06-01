import { Injectable, Logger } from '@nestjs/common';
import { SystemSettingsService } from '../system-settings/system-settings.service';
import type { BotChatHistoryEntry } from '../entities/bot-conversation-session.entity';

interface GeminiGenerateResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
  error?: { message?: string };
}

@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);

  constructor(private readonly settingsService: SystemSettingsService) {}

  async isConfigured(): Promise<boolean> {
    const key = await this.settingsService.get('GEMINI_API_KEY', '');
    return key.trim().length > 0;
  }

  private async getModel(): Promise<string> {
    const model = await this.settingsService.get('GEMINI_MODEL', 'gemini-2.0-flash');
    return model.trim() || 'gemini-2.0-flash';
  }

  async generateReply(params: {
    systemInstruction: string;
    userMessage: string;
    history?: BotChatHistoryEntry[];
  }): Promise<string | null> {
    const apiKey = (await this.settingsService.get('GEMINI_API_KEY', '')).trim();
    if (!apiKey) {
      return null;
    }

    const model = await this.getModel();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const contents = (params.history ?? [])
      .slice(-10)
      .map((entry) => ({
        role: entry.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: entry.text }],
      }));

    contents.push({
      role: 'user',
      parts: [{ text: params.userMessage }],
    });

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: params.systemInstruction }],
          },
          contents,
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 1024,
          },
        }),
      });

      const data = (await res.json()) as GeminiGenerateResponse;

      if (!res.ok) {
        const msg = data.error?.message || `HTTP ${res.status}`;
        this.logger.warn(`Gemini API error: ${msg}`);
        return null;
      }

      const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      return text || null;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Gemini request failed: ${message}`);
      return null;
    }
  }

  async evaluateCondition(params: {
    conditionType: string;
    expectedValue: string;
    userMessage: string;
    flowName: string;
  }): Promise<boolean> {
    const { conditionType, expectedValue, userMessage } = params;
    const user = userMessage.toLowerCase().trim();
    const expected = expectedValue.toLowerCase().trim();

    if (conditionType === 'equals') {
      if (user === expected) return true;
    } else if (user.includes(expected)) {
      return true;
    }

    const apiKey = (await this.settingsService.get('GEMINI_API_KEY', '')).trim();
    if (!apiKey || !expected) {
      return false;
    }

    const model = await this.getModel();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const prompt = `Você avalia condições de um chatbot "${params.flowName}".
Responda APENAS "sim" ou "não".

Condição: a mensagem do usuário ${conditionType === 'equals' ? 'é exatamente igual a' : 'contém ou expressa o significado de'} "${expectedValue}".
Mensagem do usuário: "${userMessage}"

A condição é verdadeira?`;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 16 },
        }),
      });

      const data = (await res.json()) as GeminiGenerateResponse;
      const answer = data.candidates?.[0]?.content?.parts?.[0]?.text?.toLowerCase().trim() ?? '';
      return answer.startsWith('sim');
    } catch {
      return false;
    }
  }
}
