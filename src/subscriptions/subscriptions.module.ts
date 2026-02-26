import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsController } from './subscriptions.controller';
import { Subscription } from '../entities/subscription.entity';
import { Plan } from '../entities/plan.entity';
import { Invoice } from '../entities/invoice.entity';
import { User } from '../entities/user.entity';
import { Contact } from '../entities/contact.entity';
import { UserUsage } from '../entities/user-usage.entity';
import { Campaign } from '../entities/campaign.entity';
import { ReferralCommission } from '../entities/referral-commission.entity';

import { SystemSettingsModule } from '../system-settings/system-settings.module';
import { AsaasService } from './asaas.service';

@Module({
    imports: [
        TypeOrmModule.forFeature([Subscription, Plan, Invoice, User, Contact, UserUsage, Campaign, ReferralCommission]),
        SystemSettingsModule
    ],
    controllers: [SubscriptionsController],
    providers: [SubscriptionsService, AsaasService],
    exports: [SubscriptionsService, AsaasService],
})
export class SubscriptionsModule { }
