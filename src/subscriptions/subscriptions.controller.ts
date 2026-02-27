import { Controller, Get, Post, Body, Request, UseGuards, Headers } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('subscriptions')
export class SubscriptionsController {
    constructor(private readonly subscriptionsService: SubscriptionsService) { }

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
    handleAsaasWebhook(@Body() body: any, @Headers('asaas-access-token') token: string) {
        return this.subscriptionsService.handleAsaasWebhook(body, token);
    }
}
