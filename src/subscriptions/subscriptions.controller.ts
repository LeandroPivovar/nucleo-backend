import { Controller, Get, Post, Body, Request, UseGuards, Headers } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('subscriptions')
export class SubscriptionsController {
    constructor(
        private readonly subscriptionsService: SubscriptionsService,
        private readonly webhooksService: WebhooksService,
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

        // Registrar o log no banco de dados
        await this.webhooksService.logWebhook(url, method, headers, body, 'asaas');

        // Processar a regra de negócio
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
}
