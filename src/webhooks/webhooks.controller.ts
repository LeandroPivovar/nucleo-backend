import { Controller, Post, Get, Body, Param, Req, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import type { Request } from 'express';
import { WebhooksService } from './webhooks.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CampaignsService } from '../campaigns/campaigns.service';

@Controller('webhooks')
export class WebhooksController {
    constructor(
        private readonly webhooksService: WebhooksService,
        private readonly campaignsService: CampaignsService,
    ) { }

    @Post('receive/:source')
    @HttpCode(HttpStatus.OK)
    async receiveWebhook(
        @Param('source') source: string,
        @Body() payload: any,
        @Req() req: Request,
    ) {
        const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
        const method = req.method;
        const headers = req.headers;

        // Loga o webhook recebido
        await this.webhooksService.logWebhook(url, method, headers, payload, source);

        // Processa entrega de SMS/Email da Zenvia
        if (source === 'sms-zenvia' || source === 'email-zenvia') {
            await this.campaignsService.handleDeliveredWebhook(payload);
        }

        return { success: true, message: 'Webhook received and logged' };
    }

    @UseGuards(JwtAuthGuard)
    @Get('logs')
    async getLogs() {
        return this.webhooksService.findAll();
    }

    @UseGuards(JwtAuthGuard)
    @Get('logs/:id')
    async getLog(@Param('id') id: string) {
        return this.webhooksService.findOne(+id);
    }
}
