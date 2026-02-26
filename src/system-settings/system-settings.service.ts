import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SystemSetting } from '../entities/system-setting.entity';

@Injectable()
export class SystemSettingsService {
    constructor(
        @InjectRepository(SystemSetting)
        private systemSettingRepository: Repository<SystemSetting>,
    ) { }

    async findAll(): Promise<SystemSetting[]> {
        return this.systemSettingRepository.find({ order: { key: 'ASC' } });
    }

    async findOne(key: string): Promise<SystemSetting> {
        const setting = await this.systemSettingRepository.findOne({ where: { key } });
        if (!setting) {
            throw new NotFoundException(`Setting with key ${key} not found`);
        }
        return setting;
    }

    async get(key: string, defaultValue: string = ''): Promise<string> {
        const setting = await this.systemSettingRepository.findOne({ where: { key } });
        return setting ? setting.value : defaultValue;
    }

    async set(key: string, value: string, description?: string): Promise<SystemSetting> {
        let setting = await this.systemSettingRepository.findOne({ where: { key } });
        if (setting) {
            setting.value = value;
            if (description) setting.description = description;
        } else {
            setting = this.systemSettingRepository.create({ key, value, description });
        }
        return this.systemSettingRepository.save(setting);
    }

    async upsertMany(settings: { key: string; value: string; description?: string }[]): Promise<void> {
        for (const s of settings) {
            await this.set(s.key, s.value, s.description);
        }
    }
}
