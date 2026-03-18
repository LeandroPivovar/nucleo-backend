import { Controller, Get, UseGuards } from '@nestjs/common';
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
}
