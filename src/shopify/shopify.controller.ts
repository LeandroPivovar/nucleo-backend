import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  Headers,
  Req,
  Res,
} from '@nestjs/common';
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import { ShopifyService } from './shopify.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateShopifyConnectionDto } from './dto/create-shopify-connection.dto';
import { SyncProductsDto } from './dto/sync-products.dto';
import * as crypto from 'crypto';

@Controller('shopify')
export class ShopifyController {
  constructor(private readonly shopifyService: ShopifyService) { }

  /**
   * Inicia o fluxo OAuth - retorna a URL de autorização
   */
  @Post('auth/init')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async initAuth(
    @Request() req,
    @Body() createShopifyConnectionDto: CreateShopifyConnectionDto,
  ) {
    const { shop } = createShopifyConnectionDto;

    // Gerar state token para segurança

    const state = crypto.randomBytes(32).toString('hex');

    // URL de callback (ajustar conforme necessário)
    const redirectUri = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/integrations/shopify/callback`;

    const authUrl = this.shopifyService.generateAuthUrl(
      shop,
      redirectUri,
      state,
    );

    return {
      authUrl,
      state,
      shop,
    };
  }

  /**
   * Endpoint de instalação direta (Redirecionamento 302)
   * Usado para instalação via App Store ou URL direta
   */
  @Get('auth/install')
  async install(
    @Query('shop') shop: string,
    @Res() res: ExpressResponse,
  ) {
    if (!shop) {
      return res.status(HttpStatus.BAD_REQUEST).send('Parâmetro shop é obrigatório');
    }

    const state = crypto.randomBytes(32).toString('hex');
    const redirectUri = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/integrations/shopify/callback`;
    const authUrl = this.shopifyService.generateAuthUrl(shop, redirectUri, state);

    return res.redirect(authUrl);
  }

  /**
   * Callback OAuth - recebe o código e troca por token
   * Nota: Este endpoint requer autenticação, mas o frontend já está autenticado
   */
  @Get('auth/callback')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async callback(
    @Request() req,
    @Query('code') code: string,
    @Query('shop') shop: string,
    @Query('state') state: string,
  ) {
    if (!code || !shop) {
      throw new Error('Código de autorização ou loja não fornecidos');
    }

    // Trocar código por token
    const tokenData = await this.shopifyService.exchangeCodeForToken(
      shop,
      code,
    );

    // Salvar conexão
    const connection = await this.shopifyService.createOrUpdateConnection(
      req.user.userId,
      shop,
      tokenData.access_token,
      tokenData.scope,
    );

    if (req.headers['accept']?.includes('text/html')) {
      return (req as any).res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/dashboard?shopify_connected=true`);
    }

    return {
      success: true,
      connection: {
        id: connection.id,
        shop: connection.shop,
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
    console.log(`[Shopify API] Buscando conexões para usuário ${req.user.userId}`);
    const connections = await this.shopifyService.getConnections(req.user.userId);
    return connections.map(conn => ({
      id: conn.id,
      shop: conn.shop,
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
    @Body() syncProductsDto: SyncProductsDto,
  ) {
    const { shop, ...productData } = syncProductsDto;

    const result = await this.shopifyService.syncProduct(
      req.user.userId,
      shop,
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
    @Query('shop') shop: string,
    @Query('limit') limit?: string,
    @Query('page') page?: string,
  ) {
    const products = await this.shopifyService.getProducts(
      req.user.userId,
      shop,
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
    @Query('shop') shop: string,
    @Query('limit') limit?: string,
    @Query('created_at_min') created_at_min?: string,
    @Query('created_at_max') created_at_max?: string,
    @Query('status') status?: 'open' | 'closed',
  ) {
    const checkouts = await this.shopifyService.getAbandonedCheckouts(
      req.user.userId,
      shop,
      {
        limit: limit ? parseInt(limit) : undefined,
        created_at_min,
        created_at_max,
        status,
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
    @Body() body: { shop: string; topic: string; address: string },
  ) {
    const { shop, topic, address } = body;

    const webhook = await this.shopifyService.createWebhook(
      req.user.userId,
      shop,
      topic,
      address,
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
  async listWebhooks(@Request() req, @Query('shop') shop: string) {
    const webhooks = await this.shopifyService.listWebhooks(
      req.user.userId,
      shop,
    );

    return {
      webhooks,
    };
  }

  /**
   * Endpoint para receber webhooks da Shopify
   * Este endpoint NÃO usa o JwtAuthGuard pois é chamado pela Shopify
   * A autenticação é feita via verificação de assinatura HMAC
   */
  @Post('webhooks/receive')
  @HttpCode(HttpStatus.OK)
  async receiveWebhook(
    @Req() req: ExpressRequest & { rawBody?: Buffer },
    @Headers('x-shopify-topic') topic: string,
    @Headers('x-shopify-shop-domain') shopDomain: string,
    @Headers('x-shopify-hmac-sha256') signature: string,
  ) {
    // Verificar assinatura
    const body = (req as any).rawBody?.toString() || JSON.stringify(req.body);
    const secret = process.env.SHOPIFY_WEBHOOK_SECRET || '';

    if (!this.shopifyService.verifyWebhookSignature(body, signature, secret)) {
      throw new Error('Assinatura inválida');
    }

    // Processar webhook
    const data = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    await this.shopifyService.handleWebhook(topic, shopDomain, data);

    return {
      success: true,
      topic,
      shop: shopDomain,
    };
  }

  /**
   * Endpoints de Conformidade (Mandatórios pela Shopify)
   * Pode ser usado com tópico na URL (/compliance/customers-redact) 
   * ou em uma única URL (/compliance) usando o header X-Shopify-Topic
   */
  @Post('webhooks/compliance')
  @Post('webhooks/compliance/:topic')
  @HttpCode(HttpStatus.OK)
  async receiveComplianceWebhook(
    @Req() req: ExpressRequest & { rawBody?: Buffer },
    @Param('topic') topicParam: string,
    @Headers('x-shopify-topic') topicHeader: string,
    @Headers('x-shopify-shop-domain') shopDomain: string,
    @Headers('x-shopify-hmac-sha256') signature: string,
  ) {
    const topic = topicHeader || (topicParam ? topicParam.replace(/-/g, '/') : 'unknown');
    const body = (req as any).rawBody || JSON.stringify(req.body);
    const secret = process.env.SHOPIFY_CLIENT_SECRET || process.env.SHOPIFY_WEBHOOK_SECRET || '';

    if (!this.shopifyService.verifyWebhookSignature(body, signature, secret)) {
      this.shopifyService['logger'].error(`[Shopify Compliance] Assinatura inválida para tópico: ${topic}`);
      // Shopify exige 401 para assinatura inválida
      throw new Error('Assinatura inválida');
    }

    const data = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    await this.shopifyService.handleComplianceWebhook(topic, shopDomain, data);

    return { success: true };
  }

  /**
   * Desconecta uma loja
   */
  @Post('disconnect')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async disconnect(@Request() req, @Body() body: { shop: string }) {
    await this.shopifyService.deactivateConnection(req.user.userId, body.shop);

    return {
      success: true,
      message: 'Conexão desativada com sucesso',
    };
  }

  /**
   * Sincroniza clientes da Shopify
   */
  @Post('sync/customers')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async syncCustomers(@Request() req, @Body() body: { shop: string }) {
    const result = await this.shopifyService.syncCustomers(req.user.userId, body.shop);
    return {
      success: true,
      ...result,
    };
  }

  /**
   * Sincroniza pedidos da Shopify
   */
  @Post('sync/orders')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async syncOrders(@Request() req, @Body() body: { shop: string }) {
    const result = await this.shopifyService.syncOrders(req.user.userId, body.shop);
    return {
      success: true,
      ...result,
    };
  }

  /**
   * Sincroniza carrinhos ativos e abandonados da Shopify (checkouts)
   */
  @Post('sync/checkouts')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async syncCheckouts(@Request() req, @Body() body: { shop: string }) {
    const result = await this.shopifyService.syncCheckouts(req.user.userId, body.shop);
    return {
      success: true,
      ...result,
    };
  }

  /**
   * Sincroniza produtos da Shopify para o CRM
   */
  @Post('sync/products-to-crm')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async syncProductsToCrm(@Request() req, @Body() body: { shop: string }) {
    const result = await this.shopifyService.syncProductsToCrm(req.user.userId, body.shop);
    return {
      success: true,
      ...result,
    };
  }

  /**
   * Cria um cupom de forma isolada
   */
  @Post('coupons')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  async createCoupon(
    @Request() req,
    @Body() body: {
      shop?: string;
      title: string;
      code: string;
      value: string;
      valueType: 'percentage' | 'fixed';
      endsAt?: string;
    }
  ) {
    let shop = body.shop;
    if (!shop) {
      const connections = await this.shopifyService.getConnections(req.user.userId);
      const activeConn = connections.find(c => c.isActive);
      if (!activeConn) {
        throw new Error('Nenhuma loja conectada ativa encontrada. É necessário fornecer { shop } no body ou ativar uma conexão.');
      }
      shop = activeConn.shop;
    }

    const result = await this.shopifyService.createDiscountCode(
      req.user.userId,
      shop,
      {
        title: body.title,
        code: body.code,
        value: body.value,
        valueType: body.valueType,
        endsAt: body.endsAt,
      }
    );

    return {
      success: true,
      result
    };
  }
}
