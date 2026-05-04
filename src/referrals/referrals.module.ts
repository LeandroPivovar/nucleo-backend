import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReferralsService } from './referrals.service';
import { ReferralsController } from './referrals.controller';
import { User } from '../entities/user.entity';
import { Referral } from '../entities/referral.entity';
import { ReferralCommission } from '../entities/referral-commission.entity';
import { ReferralRewardConfig } from '../entities/referral-reward-config.entity';

@Module({
    imports: [TypeOrmModule.forFeature([User, Referral, ReferralCommission, ReferralRewardConfig])],
    controllers: [ReferralsController],
    providers: [ReferralsService],
    exports: [ReferralsService],
})
export class ReferralsModule { }
