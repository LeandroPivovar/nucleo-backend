import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { SystemSettingsService } from './system-settings.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('admin/settings')
@UseGuards(JwtAuthGuard)
export class SystemSettingsController {
    constructor(private readonly systemSettingsService: SystemSettingsService) { }

    @Get()
    async findAll() {
        return this.systemSettingsService.findAll();
    }

    @Patch('bulk')
    async updateBulk(@Body() settings: { key: string; value: string; description?: string }[]) {
        await this.systemSettingsService.upsertMany(settings);
        return { success: true, message: 'Settings updated successfully' };
    }
}
