import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SystemSettingsService } from './system-settings.service';
import { SystemSettingsController } from './system-settings.controller';
import { SystemSetting } from '../entities/system-setting.entity';

@Module({
    imports: [TypeOrmModule.forFeature([SystemSetting])],
    controllers: [SystemSettingsController],
    providers: [SystemSettingsService],
    exports: [SystemSettingsService],
})
export class SystemSettingsModule { }
