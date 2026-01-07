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
   * Salva temporariamente o token e redireciona para o frontend
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

      // Log para debug
      console.log('Token recebido da Nuvemshop:', {
        tokenLength: tokenData.access_token.length,
        tokenPrefix: tokenData.access_token.substring(0, 20) + '...',
        userId: tokenData.user_id,
        scope: tokenData.scope,
      });

      // Salvar temporariamente em uma sessão/cache usando o state como chave
      // Por enquanto, vamos passar via query string mas codificando melhor
      const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:5173';
      const redirectUrl = new URL(`${frontendUrl}/integrations/nuvemshop/callback`);
      
      // Passar apenas o state e um código temporário
      // O frontend vai buscar o token usando esse código
      redirectUrl.searchParams.set('state', state);
      redirectUrl.searchParams.set('success', 'true');
      
      // Criar um código temporário para buscar o token
      // Por enquanto, vamos usar uma abordagem mais segura: passar o token codificado em base64
      // Mas isso ainda não é ideal. O ideal seria usar uma sessão/cache no backend
      const tempToken = Buffer.from(JSON.stringify({
        access_token: tokenData.access_token,
        user_id: tokenData.user_id,
        scope: tokenData.scope || '',
      })).toString('base64');
      
      redirectUrl.searchParams.set('token_data', tempToken);

      return res.redirect(redirectUrl.toString());
    } catch (error) {
      console.error('Erro no callback Nuvemshop:', error);
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
   * Endpoint de debug para verificar token salvo
   * ATENÇÃO: Este endpoint expõe o token completo - remover em produção!
   */
  @Get('debug/token')
  @UseGuards(JwtAuthGuard)
  async debugToken(
    @Request() req,
    @Query('storeId') storeId: string,
  ) {
    try {
      const connection = await this.nuvemshopService.getActiveConnection(req.user.userId, storeId);
      
      // Tentar descriptografar o token
      let decryptedToken: string | null = null;
      let decryptError: string | null = null;
      try {
        decryptedToken = await this.nuvemshopService.getAccessToken(req.user.userId, storeId);
      } catch (error) {
        decryptError = error instanceof Error ? error.message : String(error);
      }

      // Testar o token fazendo uma requisição à API
      let apiTest: { status: number; statusText: string; ok: boolean } | { error: string } | null = null;
      if (decryptedToken) {
        try {
          const testResponse = await fetch(
            `https://api.nuvemshop.com.br/v1/${storeId}/products?limit=1`,
            {
              headers: {
                'Authentication': `bearer ${decryptedToken}`,
                'User-Agent': 'Nucleo CRM (https://nucleocrm.shop)',
                'Content-Type': 'application/json',
                'Accept': 'application/json',
              },
            },
          );
          apiTest = {
            status: testResponse.status,
            statusText: testResponse.statusText,
            ok: testResponse.ok,
          };
        } catch (error) {
          apiTest = {
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }

      return {
        connection: {
          id: connection.id,
          storeId: connection.storeId,
          isActive: connection.isActive,
          scope: connection.scope,
          encryptedTokenLength: connection.accessToken.length,
          encryptedTokenPrefix: connection.accessToken.substring(0, 30) + '...',
        },
        decryption: {
          success: decryptedToken !== null,
          error: decryptError,
          decryptedTokenLength: decryptedToken ? decryptedToken.length : null,
          decryptedTokenPrefix: decryptedToken ? decryptedToken.substring(0, 20) + '...' : null,
          decryptedTokenComplete: decryptedToken, // ATENÇÃO: Expõe o token completo - remover em produção!
        },
        apiTest,
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
      };
    }
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

