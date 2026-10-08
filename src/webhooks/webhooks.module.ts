import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { WebhookLog } from '../entities/webhook-log.entity';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { ShopifyModule } from '../shopify/shopify.module';
import { NuvemshopModule } from '../nuvemshop/nuvemshop.module';

@Module({
    imports: [TypeOrmModule.forFeature([WebhookLog]), CampaignsModule, ShopifyModule, NuvemshopModule],
    controllers: [WebhooksController],
    providers: [WebhooksService],
    exports: [WebhooksService],
})
export class WebhooksModule { }
