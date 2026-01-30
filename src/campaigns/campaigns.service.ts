import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Campaign } from '../entities/campaign.entity';

@Injectable()
export class CampaignsService {
    constructor(
        @InjectRepository(Campaign)
        private campaignsRepository: Repository<Campaign>,
    ) { }

    async findAll(userId: number): Promise<Campaign[]> {
        return this.campaignsRepository.find({
            where: { userId },
            order: { createdAt: 'DESC' },
        });
    }

    async findOne(id: number, userId: number): Promise<Campaign> {
        const campaign = await this.campaignsRepository.findOne({
            where: { id, userId },
        });

        if (!campaign) {
            throw new NotFoundException(`Campanha com ID ${id} não encontrada`);
        }

        return campaign;
    }

    async create(userId: number, campaignData: Partial<Campaign>): Promise<Campaign> {
        const campaign = this.campaignsRepository.create({
            ...campaignData,
            userId,
        });
        return this.campaignsRepository.save(campaign);
    }

    async update(id: number, userId: number, campaignData: Partial<Campaign>): Promise<Campaign> {
        const campaign = await this.findOne(id, userId);
        Object.assign(campaign, campaignData);
        return this.campaignsRepository.save(campaign);
    }

    async remove(id: number, userId: number): Promise<void> {
        const campaign = await this.findOne(id, userId);
        await this.campaignsRepository.remove(campaign);
    }
}
