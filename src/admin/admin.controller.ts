import { Controller, Get, Post, Body, Param, ParseIntPipe, UseGuards } from '@nestjs/common';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('admin/stats')
@UseGuards(JwtAuthGuard)
export class AdminStatsController {
    constructor(private readonly adminService: AdminService) { }

    @Get('global')
    async getGlobalStats() {
        return this.adminService.getGlobalStats();
    }

    @Get('users/:id')
    async getUserStats(@Param('id', ParseIntPipe) id: number) {
        return this.adminService.getUserStats(id);
    }

    @Post('users/:id/reset-password')
    async resetPassword(
        @Param('id', ParseIntPipe) id: number,
        @Body('newPassword') newPassword?: string
    ) {
        return this.adminService.resetUserPassword(id, newPassword);
    }

    @Post('users/:id/credits')
    async addCredits(
        @Param('id', ParseIntPipe) id: number,
        @Body('type') type: 'email' | 'sms' | 'whatsapp',
        @Body('amount') amount: number
    ) {
        return this.adminService.addCredits(id, type, amount);
    }

    @Post('users/:id/impersonate')
    async impersonate(@Param('id', ParseIntPipe) id: number) {
        return this.adminService.impersonateUser(id);
    }
}
