import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { User } from '../entities/user.entity';
import { Subscription } from '../entities/subscription.entity';
import { Plan } from '../entities/plan.entity';
import { Invoice } from '../entities/invoice.entity';
import { Contact } from '../entities/contact.entity';
import { Campaign } from '../entities/campaign.entity';
import { UserUsage } from '../entities/user-usage.entity';
import { Sale } from '../entities/sale.entity';
import { SystemSetting } from '../entities/system-setting.entity';
import { EmailConnection } from '../entities/email-connection.entity';
import { Notification } from '../entities/notification.entity';
import { Category } from '../entities/category.entity';
import { InternalAnalytics } from '../entities/internal-analytics.entity';
import { ShopifyConnection } from '../entities/shopify-connection.entity';
import { NuvemshopConnection } from '../entities/nuvemshop-connection.entity';
import { VtexConnection } from '../entities/vtex-connection.entity';
import { LojaIntegradaConnection } from '../entities/loja-integrada-connection.entity';
import { CampaignClick } from '../entities/campaign-click.entity';
import { LeadRequest } from '../entities/lead-request.entity';
import { Product } from '../entities/product.entity';
import { TemplateRequest } from '../entities/template-request.entity';
import { LeadRequestsController } from './lead-requests.controller';
import { LeadRequestsService } from './lead-requests.service';

@Module({
    imports: [
        TypeOrmModule.forFeature([
            User,
            Subscription,
            Plan,
            Invoice,
            Contact,
            Campaign,
            UserUsage,
            Sale,
            SystemSetting,
            EmailConnection,
            Notification,
            Category,
            InternalAnalytics,
            ShopifyConnection,
            NuvemshopConnection,
            VtexConnection,
            LojaIntegradaConnection,
            CampaignClick,
            LeadRequest,
            Product,
            TemplateRequest,
        ]),
        JwtModule.registerAsync({
            imports: [ConfigModule],
            useFactory: async (configService: ConfigService) => ({
                secret: configService.get<string>('JWT_SECRET') || 'your-secret-key-change-in-production',
                signOptions: { expiresIn: '7d' },
            }),
            inject: [ConfigService],
        }),
    ],
    controllers: [AdminController, LeadRequestsController],
    providers: [AdminService, LeadRequestsService],
    exports: [AdminService, LeadRequestsService],
})
export class AdminModule { }
