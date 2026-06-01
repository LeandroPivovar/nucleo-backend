import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { BotTelegramService } from './bot-telegram.service';
import type { TelegramUpdate } from '../telegram/telegram-api.service';

@Controller('bot-flows/webhook')
export class BotFlowsWebhookController {
  private readonly logger = new Logger(BotFlowsWebhookController.name);

  constructor(private readonly botTelegramService: BotTelegramService) {}

  @Post('telegram/:flowId')
  @HttpCode(HttpStatus.OK)
  handleTelegram(
    @Param('flowId', ParseIntPipe) flowId: number,
    @Body() update: TelegramUpdate,
    @Headers('x-telegram-bot-api-secret-token') secretToken?: string,
  ) {
    void this.botTelegramService
      .handleWebhook(flowId, secretToken, update)
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Webhook Telegram fluxo ${flowId}: ${message}`);
      });

    return { ok: true };
  }
}
