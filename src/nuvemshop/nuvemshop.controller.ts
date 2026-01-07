import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  Headers,
  Req,
} from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import { NuvemshopService } from './nuvemshop.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import * as crypto from 'crypto';

@Controller('nuvemshop')
export class NuvemshopController {
  constructor(private readonly nuvemshopService: NuvemshopService) {}

  /**
   * Inicia o fluxo OAuth - retorna a URL de autorização
   */
  @Post('auth/init')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async initAuth(@Request() req) {
    // Gerar state token para segurança (CSRF protection)
    const state = crypto.randomBytes(32).toString('hex');

    const authUrl = this.nuvemshopService.generateAuthUrl(state);

    return {
      authUrl,
      state,
    };
  }

  /**
   * Callback OAuth - recebe o código e troca por token
   * Este endpoint é chamado pela Nuvemshop após o usuário autorizar
   */
  @Get('auth/callback')
  @HttpCode(HttpStatus.OK)
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
  ) {
    if (!code) {
      throw new Error('Código de autorização não fornecido');
    }

    // Trocar código por token
    const tokenData = await this.nuvemshopService.exchangeCodeForToken(code);

    // IMPORTANTE: Em uma aplicação real, você precisaria:
    // 1. Verificar o state (CSRF token) - armazenar temporariamente e comparar
    // 2. Identificar o usuário (pode passar userId via state ou usar sessão)
    // Por enquanto, vamos retornar os dados para o frontend processar

    return {
      success: true,
      access_token: tokenData.access_token,
      user_id: tokenData.user_id,
      scope: tokenData.scope,
      state, // Retornar state para verificação no frontend
    };
  }

  /**
   * Salva a conexão após o callback
   * O frontend chama este endpoint após receber o token do callback
   */
  @Post('auth/connect')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async connect(
    @Request() req,
    @Body() body: { storeId: string; accessToken: string; scope: string },
  ) {
    const { storeId, accessToken, scope } = body;

    if (!storeId || !accessToken) {
      throw new Error('storeId e accessToken são obrigatórios');
    }

    // Salvar conexão
    const connection = await this.nuvemshopService.createOrUpdateConnection(
      req.user.userId,
      storeId,
      accessToken,
      scope,
    );

    return {
      success: true,
      connection: {
        id: connection.id,
        storeId: connection.storeId,
        isActive: connection.isActive,
      },
    };
  }

  /**
   * Lista conexões do usuário
   */
  @Get('connections')
  @UseGuards(JwtAuthGuard)
  async getConnections(@Request() req) {
    const connections = await this.nuvemshopService.getConnections(req.user.userId);
    return connections.map(conn => ({
      id: conn.id,
      storeId: conn.storeId,
      isActive: conn.isActive,
      lastSyncAt: conn.lastSyncAt,
      createdAt: conn.createdAt,
    }));
  }

  /**
   * Sincroniza um produto
   */
  @Post('products/sync')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async syncProduct(
    @Request() req,
    @Body() body: {
      storeId: string;
      name: { pt?: string; en?: string; es?: string };
      description?: { pt?: string; en?: string; es?: string };
      variants: Array<{
        price: string;
        stock_management: boolean;
        stock: number;
        weight: string;
        sku?: string;
      }>;
      images?: Array<{ src: string }>;
      categories?: number[];
      id?: number;
    },
  ) {
    const { storeId, ...productData } = body;

    const result = await this.nuvemshopService.syncProduct(
      req.user.userId,
      storeId,
      productData,
    );

    return {
      success: true,
      product: result,
    };
  }

  /**
   * Busca carrinhos abandonados
   */
  @Get('checkouts/abandoned')
  @UseGuards(JwtAuthGuard)
  async getAbandonedCheckouts(
    @Request() req,
    @Query('storeId') storeId: string,
    @Query('limit') limit?: string,
    @Query('since_id') since_id?: string,
  ) {
    const checkouts = await this.nuvemshopService.getAbandonedCheckouts(
      req.user.userId,
      storeId,
      {
        limit: limit ? parseInt(limit) : undefined,
        since_id: since_id ? parseInt(since_id) : undefined,
      },
    );

    return {
      checkouts,
      count: checkouts.length,
    };
  }

  /**
   * Cria um webhook
   */
  @Post('webhooks')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  async createWebhook(
    @Request() req,
    @Body() body: { storeId: string; event: string; url: string },
  ) {
    const { storeId, event, url } = body;

    const webhook = await this.nuvemshopService.createWebhook(
      req.user.userId,
      storeId,
      event,
      url,
    );

    return {
      success: true,
      webhook,
    };
  }

  /**
   * Lista webhooks
   */
  @Get('webhooks')
  @UseGuards(JwtAuthGuard)
  async listWebhooks(@Request() req, @Query('storeId') storeId: string) {
    const webhooks = await this.nuvemshopService.listWebhooks(
      req.user.userId,
      storeId,
    );

    return {
      webhooks,
    };
  }

  /**
   * Endpoint para receber webhooks da Nuvemshop
   * Este endpoint NÃO usa o JwtAuthGuard pois é chamado pela Nuvemshop
   * A autenticação é feita via verificação de assinatura HMAC
   */
  @Post('webhooks/receive')
  @HttpCode(HttpStatus.OK)
  async receiveWebhook(
    @Req() req: ExpressRequest & { rawBody?: Buffer },
    @Headers('x-nuvemshop-hmac-sha256') signature: string,
  ) {
    // Verificar assinatura
    const body = (req as any).rawBody?.toString() || JSON.stringify(req.body);

    if (!this.nuvemshopService.verifyWebhookSignature(body, signature)) {
      throw new Error('Assinatura inválida');
    }

    // Processar webhook
    const data = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    // Aqui você pode processar o webhook conforme necessário
    // Por exemplo, salvar pedidos, atualizar produtos, etc.

    return {
      success: true,
      data,
    };
  }

  /**
   * Desconecta uma loja
   */
  @Post('disconnect')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async disconnect(@Request() req, @Body() body: { storeId: string }) {
    await this.nuvemshopService.deactivateConnection(req.user.userId, body.storeId);

    return {
      success: true,
      message: 'Conexão desativada com sucesso',
    };
  }
}

