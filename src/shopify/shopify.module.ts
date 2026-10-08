import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ShopifyController } from './shopify.controller';
import { ShopifyService } from './shopify.service';
import { ShopifyConnection } from '../entities/shopify-connection.entity';
import { Contact } from '../entities/contact.entity';
import { Sale } from '../entities/sale.entity';
import { Product } from '../entities/product.entity';
import { User } from '../entities/user.entity';
import { Plan } from '../entities/plan.entity';
import { Subscription } from '../entities/subscription.entity';
import { ShopifyWebhookEvent } from '../entities/shopify-webhook-event.entity';
import { ShopifyDataRequest } from '../entities/shopify-data-request.entity';
import { WebhookLog } from '../entities/webhook-log.entity';
import { ContactPurchase } from '../entities/contact-purchase.entity';
import { CampaignMessageEvent } from '../entities/campaign-message-event.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ShopifyConnection,
      Contact,
      Sale,
      Product,
      User,
      Plan,
      Subscription,
      ShopifyWebhookEvent,
      ShopifyDataRequest,
      WebhookLog,
      ContactPurchase,
      CampaignMessageEvent,
    ]),
    NotificationsModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET') || 'your-secret-key-change-in-production',
        signOptions: { expiresIn: '7d' },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [ShopifyController],
  providers: [ShopifyService],
  exports: [ShopifyService],
})
export class ShopifyModule { }



