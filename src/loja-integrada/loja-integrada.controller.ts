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
      const connection = await this.lojaIntegradaService.getActiveConnection(req.user.userId);
      return connection;
    } catch (error) {
      return { isActive: false };
    }
  }

  @Post('sync')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async sync(@Request() req) {
    return await this.lojaIntegradaService.syncAll(req.user.userId);
  }
}
