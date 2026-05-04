import { Controller, Get, UseGuards } from '@nestjs/common';
import { SystemSettingsService } from './system-settings.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Like } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SystemSetting } from '../entities/system-setting.entity';

@Controller('settings')
export class PublicSettingsController {
    constructor(
        @InjectRepository(SystemSetting)
        private readonly repository: Repository<SystemSetting>
    ) { }

    @Get('public')
    @UseGuards(JwtAuthGuard)
    async findPublic() {
        // Only return pricing related settings
        const settings = await this.repository.find({
            where: [
                { key: Like('UNIT_PRICE_%') },
                { key: Like('%_PKG%') }
            ]
        });
        return settings;
    }
}
