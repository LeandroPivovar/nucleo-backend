import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BotFlow } from '../entities/bot-flow.entity';
import { BotTelegramConnection } from '../entities/bot-telegram-connection.entity';
import { BotFlowsService } from './bot-flows.service';
import { BotTelegramService } from './bot-telegram.service';
import { BotFlowsController } from './bot-flows.controller';
import { BotFlowsWebhookController } from './bot-flows-webhook.controller';
import { TelegramModule } from '../telegram/telegram.module';

@Module({
  imports: [TypeOrmModule.forFeature([BotFlow, BotTelegramConnection]), TelegramModule],
  providers: [BotFlowsService, BotTelegramService],
  controllers: [BotFlowsController, BotFlowsWebhookController],
  exports: [BotFlowsService, BotTelegramService],
})
export class BotFlowsModule {}
