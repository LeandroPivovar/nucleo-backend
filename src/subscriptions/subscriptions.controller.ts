import { Controller, Get, Post, Body, Request, UseGuards, Headers, HttpCode, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { ShopifyService } from '../shopify/shopify.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('subscriptions')
export class SubscriptionsController {
    constructor(
        private readonly subscriptionsService: SubscriptionsService,
        private readonly webhooksService: WebhooksService,
        private readonly shopifyService: ShopifyService,
    ) { }

    @Get('plans')
    @UseGuards(JwtAuthGuard)
    getPlans() {
        return this.subscriptionsService.getPlans();
    }

    @Get('current')
    @UseGuards(JwtAuthGuard)
    getCurrentSubscription(@Request() req) {
        return this.subscriptionsService.getCurrentSubscription(req.user.userId);
    }

    @Get('invoices')
    @UseGuards(JwtAuthGuard)
    getInvoices(@Request() req) {
        return this.subscriptionsService.getInvoices(req.user.userId);
    }

    @Get('dashboard/stats')
    @UseGuards(JwtAuthGuard)
    getDashboardStats(@Request() req) {
        return this.subscriptionsService.getDashboardStats(req.user.userId);
    }

    @Post('checkout')
    @UseGuards(JwtAuthGuard)
    checkout(@Request() req, @Body() body: any) {
        return this.subscriptionsService.checkout(req.user.userId, body, req.ip);
    }

    @Post('cancel')
    @UseGuards(JwtAuthGuard)
    cancelSubscription(@Request() req) {
        return this.subscriptionsService.cancelSubscription(req.user.userId);
    }

    @Post('webhook/asaas')
    async handleAsaasWebhook(@Request() req, @Body() body: any, @Headers('asaas-access-token') token: string) {
        const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
        const method = req.method;
        const headers = req.headers;

        await this.webhooksService.logWebhook(url, method, headers, body, 'asaas');

        return this.subscriptionsService.handleAsaasWebhook(body, token);
    }

    @Post('buy-credits')
    @UseGuards(JwtAuthGuard)
    buyCredits(@Request() req, @Body() body: any) {
        return this.subscriptionsService.buyCredits(req.user.userId, body, req.ip);
    }

    @Post('buy-template-request')
    @UseGuards(JwtAuthGuard)
    buyTemplateRequest(@Request() req, @Body() body: any) {
        return this.subscriptionsService.buyTemplateRequest(req.user.userId, body, req.ip);
    }

    @Get('payment-gateway')
    @UseGuards(JwtAuthGuard)
    async getPaymentGateway(@Request() req) {
        // Gateway resolvido POR USUÁRIO: merchant Shopify -> Shopify; demais -> Asaas.
        const gateway = await this.subscriptionsService.resolvePaymentGatewayForUser(req.user.userId);
        const hasShopify = await this.subscriptionsService.isShopifyMerchant(req.user.userId);
        return {
            gateway,
            gatewayName: gateway === 'shopify' ? 'Shopify' : 'Asaas',
            hasShopifyConnection: hasShopify,
        };
    }

    @Post('shopify/checkout')
    @UseGuards(JwtAuthGuard)
    async shopifyCheckout(@Request() req, @Body() body: { planId: number; shop?: string; trialDays?: number }) {
        return this.subscriptionsService.shopifyCheckout(req.user.userId, body);
    }

    @Post('webhook/shopify-subscriptions-update')
    @HttpCode(200)
    async handleShopifySubscriptionsUpdateWebhook(
        @Request() req: any,
        @Headers('x-shopify-shop-domain') shopDomain: string,
        @Headers('x-shopify-topic') topic: string,
    ) {
        // Verificar assinatura sobre o corpo BRUTO. Sem fallback de reserialização:
        // JSON.stringify(req.body) quebraria o HMAC e permitiria bypass.
        const body = req.rawBody?.toString();
        if (!body) {
            throw new BadRequestException('Corpo bruto da request indisponível para verificação HMAC');
        }
        const signature = req.headers['x-shopify-hmac-sha256'];
        // Webhooks app-managed (TOML) são assinados com o client secret do app.
        const secret = process.env.SHOPIFY_CLIENT_SECRET || process.env.SHOPIFY_WEBHOOK_SECRET || '';

        if (!this.shopifyService.verifyWebhookSignature(body, signature, secret)) {
            throw new UnauthorizedException('Assinatura inválida');
        }

        const data = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

        await this.webhooksService.logWebhook(
            `${req.protocol}://${req.get('host')}${req.originalUrl}`,
            req.method,
            req.headers,
            data,
            'shopify-billing',
        );

        await this.subscriptionsService.handleShopifySubscriptionsUpdateWebhook(data, shopDomain);

        return { success: true };
    }
}
