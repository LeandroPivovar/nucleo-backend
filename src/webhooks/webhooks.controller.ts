import { Controller, Post, Get, Body, Param, Req, Request, UseGuards, HttpCode, HttpStatus, UnauthorizedException } from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import { WebhooksService } from './webhooks.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CampaignsService } from '../campaigns/campaigns.service';
import { ShopifyService } from '../shopify/shopify.service';
import { NuvemshopService } from '../nuvemshop/nuvemshop.service';

@Controller('webhooks')
export class WebhooksController {
    constructor(
        private readonly webhooksService: WebhooksService,
        private readonly campaignsService: CampaignsService,
        private readonly shopifyService: ShopifyService,
        private readonly nuvemshopService: NuvemshopService,
    ) { }

    private normalizeSource(source?: string): string {
        const normalized = String(source || 'unknown').toLowerCase().trim();

        if (['mail', 'email', 'emails', 'zenvia-email'].includes(normalized)) {
            return 'email-zenvia';
        }

        if (['sms', 'zenvia-sms'].includes(normalized)) {
            return 'sms-zenvia';
        }

        return normalized;
    }

    private getWebhookUrl(req: ExpressRequest): string {
        const host = req.get('host') || '';
        const forwardedProto = req.get('x-forwarded-proto');
        const protocol = forwardedProto || (host.includes('nucleocrm.com.br') ? 'https' : req.protocol);
        return `${protocol}://${host}${req.originalUrl}`;
    }

    @Get('receive')
    @HttpCode(HttpStatus.OK)
    async receiveWebhookHealth(@Req() req: ExpressRequest) {
        return {
            success: true,
            message: 'Webhook endpoint active',
            url: this.getWebhookUrl(req),
            method: 'POST',
        };
    }

    @Get('receive/:source')
    @HttpCode(HttpStatus.OK)
    async receiveWebhookSourceHealth(
        @Param('source') source: string,
        @Req() req: ExpressRequest,
    ) {
        return {
            success: true,
            message: 'Webhook endpoint active',
            source: this.normalizeSource(source),
            url: this.getWebhookUrl(req),
            method: 'POST',
        };
    }

    @Post('receive')
    @HttpCode(HttpStatus.OK)
    async receiveGenericWebhook(
        @Body() payload: any,
        @Req() req: ExpressRequest,
    ) {
        return this.handleIncomingWebhook('unknown', payload, req);
    }

    @Post('receive/:source')
    @HttpCode(HttpStatus.OK)
    async receiveWebhook(
        @Param('source') source: string,
        @Body() payload: any,
        @Req() req: ExpressRequest,
    ) {
        return this.handleIncomingWebhook(source, payload, req);
    }

    private async handleIncomingWebhook(source: string, payload: any, req: ExpressRequest & { rawBody?: Buffer }) {
        const normalizedSource = this.normalizeSource(source);
        const url = this.getWebhookUrl(req);
        const method = req.method;
        const headers = req.headers;

        // Dono do webhook (tenant) para o log; resolvido pela conexão da loja.
        let ownerUserId: number | null = null;

        // Integrações de loja exigem assinatura HMAC válida sobre o corpo BRUTO.
        // Sem isso, qualquer um poderia forjar pedidos/checkouts e disparar
        // campanhas (consumindo créditos) ou poluir o CRM de outro usuário.
        if (normalizedSource === 'shopify') {
            const rawBody = req.rawBody;
            const signature = String(headers['x-shopify-hmac-sha256'] || '');
            const secret = process.env.SHOPIFY_CLIENT_SECRET || process.env.SHOPIFY_WEBHOOK_SECRET || '';

            if (!rawBody || !this.shopifyService.verifyWebhookSignature(rawBody, signature, secret)) {
                throw new UnauthorizedException('Assinatura Shopify inválida');
            }

            const shopDomain = String(headers['x-shopify-shop-domain'] || '');
            const connection = shopDomain
                ? await this.shopifyService.findActiveConnectionByShop(shopDomain)
                : null;
            ownerUserId = connection?.userId ?? null;
        } else if (normalizedSource === 'nuvemshop') {
            const rawBody = req.rawBody;
            const signature = String(
                headers['x-linkedstore-hmac-sha256'] || headers['x-nuvemshop-hmac-sha256'] || '',
            );

            if (!rawBody || !this.nuvemshopService.verifyWebhookSignature(rawBody.toString('utf8'), signature)) {
                throw new UnauthorizedException('Assinatura Nuvemshop inválida');
            }

            const storeId = payload?.store_id || headers['x-linked-store-id'];
            const connection = storeId
                ? await this.nuvemshopService.findActiveConnectionByStoreId(String(storeId))
                : null;
            ownerUserId = connection?.userId ?? null;
        }

        await this.webhooksService.logWebhook(
            url,
            method,
            headers,
            payload,
            normalizedSource,
            ownerUserId,
        );

        if (normalizedSource === 'shopify' || normalizedSource === 'nuvemshop') {
            this.campaignsService.handleIntegrationWebhook(normalizedSource, headers, payload).catch(err => {
                console.error(`Erro ao processar webhook de integração [${normalizedSource}]:`, err);
            });
            return { success: true, message: 'Integration webhook received' };
        }

        if (normalizedSource === 'sms-zenvia' || normalizedSource === 'email-zenvia') {
            await this.campaignsService.handleDeliveredWebhook({
                ...payload,
                channel: payload?.channel || (normalizedSource === 'email-zenvia' ? 'email' : 'sms'),
            });
        }

        return { success: true, message: 'Webhook received and logged' };
    }

    @UseGuards(JwtAuthGuard)
    @Get('logs')
    async getLogs(@Request() req) {
        // Admin enxerga tudo; usuário comum só os webhooks das próprias conexões.
        return this.webhooksService.findAllForUser(req.user.userId, req.user.role === 'admin');
    }

    @UseGuards(JwtAuthGuard)
    @Get('logs/:id')
    async getLog(@Request() req, @Param('id') id: string) {
        return this.webhooksService.findOneForUser(+id, req.user.userId, req.user.role === 'admin');
    }
}
