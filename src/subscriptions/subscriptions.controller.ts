import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('subscriptions')
@UseGuards(JwtAuthGuard)
export class SubscriptionsController {
    constructor(private readonly subscriptionsService: SubscriptionsService) { }

    @Get('plans')
    getPlans() {
        return this.subscriptionsService.getPlans();
    }

    @Get('current')
    getCurrentSubscription(@Request() req) {
        return this.subscriptionsService.getCurrentSubscription(req.user.userId);
    }

    @Get('invoices')
    getInvoices(@Request() req) {
        return this.subscriptionsService.getInvoices(req.user.userId);
    }

    @Get('dashboard/stats')
    getDashboardStats(@Request() req) {
        return this.subscriptionsService.getDashboardStats(req.user.userId);
    }
}
