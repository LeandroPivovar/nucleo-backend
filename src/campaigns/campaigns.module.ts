import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CampaignsService } from './campaigns.service';
import { CampaignsController, CampaignsWebhookController, CampaignsTrackingController } from './campaigns.controller';
import { Campaign } from '../entities/campaign.entity';
import { Contact } from '../entities/contact.entity';
import { Sale } from '../entities/sale.entity';
import { UserUsage } from '../entities/user-usage.entity';
import { CampaignSchedulerService } from './campaign-scheduler/campaign-scheduler.service';
import { ShopifyConnection } from '../entities/shopify-connection.entity';
import { NuvemshopConnection } from '../entities/nuvemshop-connection.entity';
import { CampaignQueue } from '../entities/campaign-queue.entity';
import { CampaignClick } from '../entities/campaign-click.entity';

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
        TypeOrmModule.forFeature([Campaign, Contact, Sale, UserUsage, User, Subscription, ShopifyConnection, NuvemshopConnection, CampaignQueue, CampaignClick]),
        ZenviaModule,
        ContactsModule,
        EmailModule,
        NotificationsModule,
        ShopifyModule,
        NuvemshopModule
    ],
    providers: [CampaignsService, CampaignSchedulerService],
    controllers: [CampaignsController, CampaignsWebhookController, CampaignsTrackingController],
    exports: [CampaignsService],
})
export class CampaignsModule { }
