import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CampaignsService } from './campaigns.service';
import { CampaignsController } from './campaigns.controller';
import { Campaign } from '../entities/campaign.entity';
import { CampaignSchedulerService } from './campaign-scheduler/campaign-scheduler.service';

import { ZenviaModule } from '../zenvia/zenvia.module';
import { ContactsModule } from '../contacts/contacts.module';
import { EmailModule } from '../email/email.module';

@Module({
    imports: [
        TypeOrmModule.forFeature([Campaign]),
        ZenviaModule,
        ContactsModule,
        EmailModule
    ],
    providers: [CampaignsService, CampaignSchedulerService],
    controllers: [CampaignsController],
    exports: [CampaignsService],
})
export class CampaignsModule { }
