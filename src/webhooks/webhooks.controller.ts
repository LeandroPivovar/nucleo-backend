import { Controller, Post, Get, Body, Param, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { WebhooksService } from './webhooks.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('webhooks')
export class WebhooksController {
    constructor(private readonly webhooksService: WebhooksService) { }

    @Post('receive/:source')
    async receiveWebhook(
        @Param('source') source: string,
        @Body() payload: any,
        @Req() req: Request,
    ) {
        const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
        const method = req.method;
        const headers = req.headers;

        await this.webhooksService.logWebhook(url, method, headers, payload, source);

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
