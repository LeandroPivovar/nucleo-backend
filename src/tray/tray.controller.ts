import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  UseGuards,
  Req,
  Res,
  Logger,
} from '@nestjs/common';
import { TrayService } from './tray.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { Response } from 'express';

@Controller('api/tray')
export class TrayController {
  private readonly logger = new Logger(TrayController.name);

  constructor(private readonly trayService: TrayService) {}

  @UseGuards(JwtAuthGuard)
  @Get('connection')
  async getConnection(@Req() req) {
    const connection = await this.trayService.getActiveConnection(req.user.id);
    return connection || { isActive: false };
  }

  @UseGuards(JwtAuthGuard)
  @Get('auth-url')
  async getAuthUrl(
    @Query('shopUrl') shopUrl: string,
    @Query('callbackUrl') callbackUrl: string,
    @Req() req,
  ) {
    // Usar o ID do usuário como 'state' para segurança
    const state = req.user.id.toString();
    const url = await this.trayService.generateAuthUrl(shopUrl, state, callbackUrl);
    return { url };
  }

  @UseGuards(JwtAuthGuard)
  @Post('finalize-connection')
  async finalizeConnection(
    @Body('code') code: string,
    @Body('shopUrl') shopUrl: string,
    @Req() req,
  ) {
    const authData = await this.trayService.exchangeCodeForToken(shopUrl, code);
    const connection = await this.trayService.saveConnection(req.user.id, shopUrl, authData);
    
    // Iniciar sincronização inicial em background
    this.trayService.syncProducts(req.user.id).catch(e => this.logger.error(`Initial Sync Products Error: ${e.message}`));
    this.trayService.syncCustomers(req.user.id).catch(e => this.logger.error(`Initial Sync Customers Error: ${e.message}`));
    this.trayService.syncOrders(req.user.id).catch(e => this.logger.error(`Initial Sync Orders Error: ${e.message}`));

    return { success: true, connection };
  }

  @UseGuards(JwtAuthGuard)
  @Post('sync')
  async triggerSync(@Req() req) {
    const userId = req.user.id;
    
    // Disparar sincronizações
    const results = {
      products: await this.trayService.syncProducts(userId),
      customers: await this.trayService.syncCustomers(userId),
      orders: await this.trayService.syncOrders(userId),
      checkouts: await this.trayService.syncCheckouts(userId),
    };

    return results;
  }
}
