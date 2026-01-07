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
  Res,
  Redirect,
  BadRequestException,
} from '@nestjs/common';
import type { Request as ExpressRequest, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { NuvemshopService } from './nuvemshop.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import * as crypto from 'crypto';

@Controller('nuvemshop')
export class NuvemshopController {
  constructor(
    private readonly nuvemshopService: NuvemshopService,
    private readonly configService: ConfigService,
  ) {}

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
   * Redireciona para o frontend com os dados necessários
   */
  @Get('auth/callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    if (!code) {
      // Redirecionar para frontend com erro
      const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:5173';
      return res.redirect(`${frontendUrl}/integrations/nuvemshop/callback?error=no_code`);
    }

    try {
      // Trocar código por token
      const tokenData = await this.nuvemshopService.exchangeCodeForToken(code);

      // Redirecionar para o frontend com os dados na query string
      // O frontend vai processar e salvar a conexão
      const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:5173';
      const redirectUrl = new URL(`${frontendUrl}/integrations/nuvemshop/callback`);
      
      // Passar os dados via query string (o frontend vai processar)
      redirectUrl.searchParams.set('code', code);
      redirectUrl.searchParams.set('state', state);
      redirectUrl.searchParams.set('access_token', tokenData.access_token);
      redirectUrl.searchParams.set('user_id', tokenData.user_id);
      redirectUrl.searchParams.set('scope', tokenData.scope || '');

      return res.redirect(redirectUrl.toString());
    } catch (error) {
      // Redirecionar para frontend com erro
      const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:5173';
      return res.redirect(`${frontendUrl}/integrations/nuvemshop/callback?error=auth_failed`);
    }
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
      throw new BadRequestException('storeId e accessToken são obrigatórios');
    }

    // Validar formato do token (deve ser uma string não vazia)
    if (typeof accessToken !== 'string' || accessToken.trim().length === 0) {
      throw new BadRequestException('Token de acesso inválido');
    }

    // Não validar o token aqui - ele veio diretamente da Nuvemshop e deve ser válido
    // A validação acontecerá quando o token for usado nas requisições à API

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
   * Busca produtos da loja
   */
  @Get('products')
  @UseGuards(JwtAuthGuard)
  async getProducts(
    @Request() req,
    @Query('storeId') storeId: string,
    @Query('limit') limit?: string,
    @Query('page') page?: string,
  ) {
    const products = await this.nuvemshopService.getProducts(
      req.user.userId,
      storeId,
      {
        limit: limit ? parseInt(limit) : undefined,
        page: page ? parseInt(page) : undefined,
      },
    );

    return {
      products,
      count: products.length,
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
   * Testa a conexão e valida o token
   */
  @Post('test-connection')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async testConnection(
    @Request() req,
    @Body() body: { storeId: string },
  ) {
    const isValid = await this.nuvemshopService.testToken(req.user.userId, body.storeId);

    return {
      success: isValid,
      message: isValid ? 'Conexão válida' : 'Token inválido. Reconecte a integração.',
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

