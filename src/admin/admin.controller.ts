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

    @Get('stats/users/:id')
    async getUserStats(@Param('id', ParseIntPipe) id: number) {
        return this.adminService.getUserStats(id);
    }

    @Post('stats/users/:id/reset-password')
    async resetPassword(
        @Param('id', ParseIntPipe) id: number,
        @Body('newPassword') newPassword?: string
    ) {
        return this.adminService.resetUserPassword(id, newPassword);
    }

    @Post('stats/users/:id/credits')
    async addCredits(
        @Param('id', ParseIntPipe) id: number,
        @Body('type') type: 'email' | 'sms' | 'whatsapp',
        @Body('amount') amount: number
    ) {
        return this.adminService.addCredits(id, type, amount);
    }

    @Post('stats/users/:id/impersonate')
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

    @Get('capacity/stats')
    async getCapacityStats() {
        return this.adminService.getCapacityStats();
    }

    @Get('email-connections/pending')
    async getPendingEmailConnections() {
        return this.adminService.getPendingEmailConnections();
    }

    @Post('email-connections/:id/approve')
    async approveEmailConnection(@Param('id', ParseIntPipe) id: number) {
        return this.adminService.approveEmailConnection(id);
    }

    @Post('email-connections/:id/reject')
    async rejectEmailConnection(
        @Param('id', ParseIntPipe) id: number,
        @Body('adminNote') adminNote: string
    ) {
        return this.adminService.rejectEmailConnection(id, adminNote);
    }

    @Get('overview/stats')
    async getSystemOverview() {
        return this.adminService.getSystemOverviewStats();
    }

    @Get('overview/events')
    async getEventStats(@Query('days') days?: string) {
        return this.adminService.getDailyEventStats(days ? parseInt(days) : 30);
    }

    @Post('generate-test-account')
    async generateTestAccount(@Body('level') level: 'low' | 'medium' | 'high') {
        return this.adminService.generateTestAccount(level || 'low');
    }

    // --- Template Requests Management ---
    @Get('template-requests')
    async getTemplateRequests() {
        return this.adminService.getTemplateRequests();
    }

    @Post('template-requests/:id/approve')
    async approveTemplateRequest(
        @Param('id', ParseIntPipe) id: number,
        @Body('adminNote') adminNote?: string
    ) {
        return this.adminService.approveTemplateRequest(id, adminNote);
    }

    @Post('template-requests/:id/reject')
    async rejectTemplateRequest(
        @Param('id', ParseIntPipe) id: number,
        @Body('adminNote') adminNote: string
    ) {
        return this.adminService.rejectTemplateRequest(id, adminNote);
    }

    // --- Admin Campaign Templates ---
    @Get('campaign-templates')
    async getCampaignTemplates() {
        return this.adminService.getCampaignTemplates();
    }

    @Post('campaign-templates')
    async createCampaignTemplate(@Body() data: any) {
        return this.adminService.createCampaignTemplate(data);
    }

    @Patch('campaign-templates/:id')
    async updateCampaignTemplate(
        @Param('id', ParseIntPipe) id: number,
        @Body() data: any
    ) {
        return this.adminService.updateCampaignTemplate(id, data);
    }

    @Delete('campaign-templates/:id')
    async deleteCampaignTemplate(@Param('id', ParseIntPipe) id: number) {
        return this.adminService.deleteCampaignTemplate(id);
    }
}
