import { Controller, Get, Param, UseGuards, Request } from '@nestjs/common';
import { ReferralsService } from './referrals.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

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
}
