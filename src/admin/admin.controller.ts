import { Controller, Get, Post, Patch, Delete, Body, Param, ParseIntPipe, UseGuards, Query } from '@nestjs/common';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('admin')
@UseGuards(JwtAuthGuard)
export class AdminController {
    constructor(private readonly adminService: AdminService) { }

    @Get('stats/global')
    async getGlobalStats(
        @Query('month') month?: string,
        @Query('year') year?: string
    ) {
        return this.adminService.getGlobalStats(
            month ? parseInt(month) : undefined,
            year ? parseInt(year) : undefined
        );
    }

    @Get('finance/stats')
    async getFinanceStats() {
        return this.adminService.getFinanceStats();
    }

    @Get('settings')
    async getSettings() {
        return this.adminService.getSystemSettings();
    }

    @Patch('settings/:key')
    async updateSetting(
        @Param('key') key: string,
        @Body('value') value: string,
        @Body('description') description?: string
    ) {
        return this.adminService.updateSystemSetting(key, value, description);
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
        @Body('type') type: 'email' | 'sms',
        @Body('amount') amount: number
    ) {
        return this.adminService.addCredits(id, type, amount);
    }

    @Post('users/:id/impersonate')
    async impersonate(@Param('id', ParseIntPipe) id: number) {
        return this.adminService.impersonateUser(id);
    }

    // --- Plan Management ---
    @Get('plans')
    async getAllPlans() {
        return this.adminService.getAllPlans();
    }

    @Post('plans')
    async createPlan(@Body() data: any) {
        return this.adminService.createPlan(data);
    }

    @Patch('plans/:id')
    async updatePlan(@Param('id', ParseIntPipe) id: number, @Body() data: any) {
        return this.adminService.updatePlan(id, data);
    }

    @Delete('plans/:id')
    async deletePlan(@Param('id', ParseIntPipe) id: number) {
        return this.adminService.deletePlan(id);
    }
}
