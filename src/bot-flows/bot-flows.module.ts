import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BotFlow } from '../entities/bot-flow.entity';
import { BotTelegramConnection } from '../entities/bot-telegram-connection.entity';
import { BotConversationSession } from '../entities/bot-conversation-session.entity';
import { BotFlowsService } from './bot-flows.service';
import { BotTelegramService } from './bot-telegram.service';
import { BotFlowExecutorService } from './bot-flow-executor.service';
import { BotFlowsController } from './bot-flows.controller';
import { BotFlowsWebhookController } from './bot-flows-webhook.controller';
import { TelegramModule } from '../telegram/telegram.module';
import { GeminiModule } from '../gemini/gemini.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([BotFlow, BotTelegramConnection, BotConversationSession]),
    TelegramModule,
    GeminiModule,
  ],
  providers: [BotFlowsService, BotTelegramService, BotFlowExecutorService],
  controllers: [BotFlowsController, BotFlowsWebhookController],
  exports: [BotFlowsService, BotTelegramService, BotFlowExecutorService],
})
export class BotFlowsModule {}
