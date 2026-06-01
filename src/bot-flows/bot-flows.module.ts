import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BotFlow } from '../entities/bot-flow.entity';
import { BotFlowsService } from './bot-flows.service';
import { BotFlowsController } from './bot-flows.controller';

@Module({
  imports: [TypeOrmModule.forFeature([BotFlow])],
  providers: [BotFlowsService],
  controllers: [BotFlowsController],
  exports: [BotFlowsService],
})
export class BotFlowsModule {}
