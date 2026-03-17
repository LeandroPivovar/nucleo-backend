import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { WebhookLog } from '../entities/webhook-log.entity';
import { CampaignsModule } from '../campaigns/campaigns.module';

@Module({
    imports: [TypeOrmModule.forFeature([WebhookLog]), CampaignsModule],
    controllers: [WebhooksController],
    providers: [WebhooksService],
    exports: [WebhooksService],
})
export class WebhooksModule { }
