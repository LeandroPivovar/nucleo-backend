import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CampaignsService } from './campaigns.service';
import { CampaignsController } from './campaigns.controller';
import { Campaign } from '../entities/campaign.entity';
import { Contact } from '../entities/contact.entity';
import { UserUsage } from '../entities/user-usage.entity';
import { CampaignSchedulerService } from './campaign-scheduler/campaign-scheduler.service';

import { ZenviaModule } from '../zenvia/zenvia.module';
import { ContactsModule } from '../contacts/contacts.module';
import { EmailModule } from '../email/email.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ShopifyModule } from '../shopify/shopify.module';
import { NuvemshopModule } from '../nuvemshop/nuvemshop.module';

import { User } from '../entities/user.entity';
import { Subscription } from '../entities/subscription.entity';

@Module({
    imports: [
        TypeOrmModule.forFeature([Campaign, Contact, UserUsage, User, Subscription]),
        ZenviaModule,
        ContactsModule,
        EmailModule,
        NotificationsModule,
        ShopifyModule,
        NuvemshopModule
    ],
    providers: [CampaignsService, CampaignSchedulerService],
    controllers: [CampaignsController],
    exports: [CampaignsService],
})
export class CampaignsModule { }
