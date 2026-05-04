import { Controller, Get, Post, Patch, Param, UseGuards, Request, Query, Body, ParseIntPipe } from '@nestjs/common';
import { ReferralsService } from './referrals.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';

@Controller('referrals')
export class ReferralsController {
    constructor(private readonly referralsService: ReferralsService) { }

    @Get('validate/:code')
    async validateCode(@Param('code') code: string) {
        return this.referralsService.validateCode(code);
    }

    @UseGuards(JwtAuthGuard)
    @Get('my-code')
    async getMyCode(@Request() req) {
        return this.referralsService.getMyCode(req.user.id);
    }

    @UseGuards(JwtAuthGuard)
    @Get('my-referrals')
    async getMyReferrals(@Request() req) {
        return this.referralsService.getMyReferrals(req.user.id);
    }

    @UseGuards(JwtAuthGuard)
    @Get('stats')
    async getStats(@Request() req) {
        return this.referralsService.getStats(req.user.id);
    }

    @UseGuards(JwtAuthGuard)
    @Post('generate')
    async generateMyCode(@Request() req) {
        return this.referralsService.generateMyCode(req.user.id);
    }

    // --- Admin Endpoints ---

    @UseGuards(JwtAuthGuard, AdminGuard)
    @Get('admin/stats')
    async getAdminStats() {
        return this.referralsService.getAdminStats();
    }

    @UseGuards(JwtAuthGuard, AdminGuard)
    @Get('admin/list')
    async getAdminList(@Query() query: any) {
        return this.referralsService.getAdminList(query);
    }

    @UseGuards(JwtAuthGuard, AdminGuard)
    @Patch('admin/:id/status')
    async updateReferralStatus(
        @Param('id', ParseIntPipe) id: number,
        @Body('status') status: string
    ) {
        return this.referralsService.updateReferralStatus(id, status);
    }

    @UseGuards(JwtAuthGuard, AdminGuard)
    @Get('admin/commissions')
    async getAdminCommissions(@Query() query: any) {
        return this.referralsService.getAdminCommissions(query);
    }

    @UseGuards(JwtAuthGuard, AdminGuard)
    @Patch('admin/commissions/:id/status')
    async updateCommissionStatus(
        @Param('id', ParseIntPipe) id: number,
        @Body('status') status: string
    ) {
        return this.referralsService.updateCommissionStatus(id, status);
    }

    @UseGuards(JwtAuthGuard, AdminGuard)
    @Get('admin/ranking')
    async getRanking() {
        return this.referralsService.getRanking();
    }

    @UseGuards(JwtAuthGuard, AdminGuard)
    @Get('admin/rewards-config')
    async getRewardConfig() {
        return this.referralsService.getRewardConfig();
    }

    @UseGuards(JwtAuthGuard, AdminGuard)
    @Post('admin/rewards-config')
    async updateRewardConfig(
        @Body('id') id: number,
        @Body() data: any
    ) {
        return this.referralsService.updateRewardConfig(id, data);
    }

    @UseGuards(JwtAuthGuard, AdminGuard)
    @Get('admin/users')
    async getAdminUsers() {
        return this.referralsService.getAdminUserList();
    }

    @UseGuards(JwtAuthGuard, AdminGuard)
    @Patch('admin/users/:id/percentage')
    async updateAdminUserPercentage(
        @Param('id', ParseIntPipe) id: number,
        @Body('percentage') percentage: number
    ) {
        return this.referralsService.updateAdminUserPercentage(id, percentage);
    }
}
