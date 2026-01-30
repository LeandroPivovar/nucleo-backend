import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CampaignsService } from './campaigns.service';
import { CampaignsController } from './campaigns.controller';
import { Campaign } from '../entities/campaign.entity';

@Module({
    imports: [TypeOrmModule.forFeature([Campaign])],
    providers: [CampaignsService],
    controllers: [CampaignsController],
    exports: [CampaignsService],
})
export class CampaignsModule { }
