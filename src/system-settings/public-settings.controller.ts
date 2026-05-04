import { Controller, Get, UseGuards } from '@nestjs/common';
import { SystemSettingsService } from './system-settings.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Like, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
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
        return this.repository.find({
            where: [
                { key: Like('UNIT_PRICE_%') },
                { key: Like('%_PKG%') }
            ]
        });
    }
}
