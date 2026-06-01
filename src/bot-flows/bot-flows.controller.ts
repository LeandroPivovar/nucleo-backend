import { Controller, Get, Post, Body, UseGuards, Request } from '@nestjs/common';
import { BotFlowsService } from './bot-flows.service';
import { SaveBotFlowDto } from './dto/save-bot-flow.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('bot-flows')
@UseGuards(JwtAuthGuard)
export class BotFlowsController {
  constructor(private readonly botFlowsService: BotFlowsService) {}

  @Get()
  async getFlow(@Request() req) {
    return this.botFlowsService.getFlow(req.user.userId);
  }

  @Post()
  async saveFlow(@Request() req, @Body() dto: SaveBotFlowDto) {
    return this.botFlowsService.saveFlow(req.user.userId, dto);
  }
}
