import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Request,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { LojaIntegradaService } from './loja-integrada.service';

@Controller('loja-integrada')
export class LojaIntegradaController {
  constructor(private readonly lojaIntegradaService: LojaIntegradaService) {}

  @Get('connection')
  @UseGuards(JwtAuthGuard)
  async getConnection(@Request() req) {
    try {
      const userId = req.user.userId || req.user.id;
      const connection = await this.lojaIntegradaService.getActiveConnection(userId);
      return connection;
    } catch (error) {
      return { isActive: false };
    }
  }

  @Post('connect')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async connect(
    @Request() req,
    @Body() data: { storeName: string; apiKey: string; applicationKey?: string },
  ) {
    const userId = req.user.userId || req.user.id;
    return await this.lojaIntegradaService.createOrUpdateConnection(
      userId,
      data.storeName,
      data.apiKey,
      data.applicationKey,
    );
  }

  @Post('sync')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async sync(@Request() req) {
    const userId = req.user.userId || req.user.id;
    return await this.lojaIntegradaService.syncAll(userId);
  }

  @Post('disconnect')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async disconnect(@Request() req) {
    const userId = req.user.userId || req.user.id;
    await this.lojaIntegradaService.deactivateConnection(userId);
    return { success: true, message: 'Conexão desativada com sucesso' };
  }
}
