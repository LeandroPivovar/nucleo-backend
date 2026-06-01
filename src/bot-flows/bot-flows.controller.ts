import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
  ParseIntPipe,
} from '@nestjs/common';
import { BotFlowsService } from './bot-flows.service';
import { BotTelegramService } from './bot-telegram.service';
import { SaveBotFlowDto } from './dto/save-bot-flow.dto';
import { CreateBotFlowDto } from './dto/create-bot-flow.dto';
import { UpdateBotFlowDto } from './dto/update-bot-flow.dto';
import { ConnectTelegramDto } from './dto/connect-telegram.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('bot-flows')
@UseGuards(JwtAuthGuard)
export class BotFlowsController {
  constructor(
    private readonly botFlowsService: BotFlowsService,
    private readonly botTelegramService: BotTelegramService,
  ) {}

  @Get()
  findAll(@Request() req) {
    return this.botFlowsService.findAll(req.user.userId);
  }

  @Get(':id')
  async findOne(@Request() req, @Param('id', ParseIntPipe) id: number) {
    const flow = await this.botFlowsService.findOne(req.user.userId, id);
    return flow;
  }

  @Post()
  create(@Request() req, @Body() dto: CreateBotFlowDto) {
    return this.botFlowsService.create(req.user.userId, dto);
  }

  @Patch(':id')
  updateMeta(
    @Request() req,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateBotFlowDto,
  ) {
    return this.botFlowsService.updateMeta(req.user.userId, id, dto);
  }

  @Post(':id/save')
  saveFlow(
    @Request() req,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SaveBotFlowDto,
  ) {
    return this.botFlowsService.saveFlow(req.user.userId, id, dto);
  }

  @Delete(':id')
  async remove(@Request() req, @Param('id', ParseIntPipe) id: number) {
    await this.botTelegramService.disconnect(req.user.userId, id).catch(() => undefined);
    await this.botFlowsService.remove(req.user.userId, id);
    return { success: true };
  }

  @Get(':id/telegram/status')
  getTelegramStatus(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.botTelegramService.getStatus(req.user.userId, id);
  }

  @Post(':id/telegram/connect')
  connectTelegram(
    @Request() req,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ConnectTelegramDto,
  ) {
    return this.botTelegramService.connect(req.user.userId, id, dto.botToken);
  }

  @Post(':id/telegram/disconnect')
  disconnectTelegram(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.botTelegramService.disconnect(req.user.userId, id);
  }
}
