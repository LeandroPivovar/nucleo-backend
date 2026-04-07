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
    const connection = await this.lojaIntegradaService.getConnection(req.user.userId);
    return connection || { isActive: false };
  }

  @Post('sync')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async sync(@Request() req) {
    return await this.lojaIntegradaService.sync(req.user.userId);
  }
}
