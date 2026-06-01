import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ProductsModule } from './products/products.module';
import { SalesModule } from './sales/sales.module';
import { ContactsModule } from './contacts/contacts.module';
import { ContactPurchasesModule } from './contact-purchases/contact-purchases.module';
import { GroupsModule } from './groups/groups.module';
import { TagsModule } from './tags/tags.module';
import { ScoreConfigModule } from './score-config/score-config.module';
import { EmailModule } from './email/email.module';
import { EmailConnectionsModule } from './email-connections/email-connections.module';
import { ShopifyModule } from './shopify/shopify.module';
import { NuvemshopModule } from './nuvemshop/nuvemshop.module';
import { VtexModule } from './vtex/vtex.module';
import { CampaignsModule } from './campaigns/campaigns.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { PixelsModule } from './pixels/pixels.module';
import { ReferralsModule } from './referrals/referrals.module';
import { LojaIntegradaModule } from './loja-integrada/loja-integrada.module';
import { NotificationsModule } from './notifications/notifications.module';
import { TicketsModule } from './tickets/tickets.module';
import { TrayModule } from './tray/tray.module';
import { EmailConnection } from './entities/email-connection.entity';
import { ShopifyConnection } from './entities/shopify-connection.entity';
import { NuvemshopConnection } from './entities/nuvemshop-connection.entity';
import { VtexConnection } from './entities/vtex-connection.entity';
import { Campaign } from './entities/campaign.entity';
import { User } from './entities/user.entity';
import { Product } from './entities/product.entity';
import { Sale } from './entities/sale.entity';
import { Contact } from './entities/contact.entity';
import { ContactPurchase } from './entities/contact-purchase.entity';
import { ContactTag } from './entities/contact-tag.entity';
import { ContactSegmentation } from './entities/contact-segmentation.entity';
import { Group } from './entities/group.entity';
import { Tag } from './entities/tag.entity';
import { ScoreConfig } from './entities/score-config.entity';
import { PasswordReset } from './entities/password-reset.entity';
import { EmailVerification } from './entities/email-verification.entity';
import { Plan } from './entities/plan.entity';
import { Subscription } from './entities/subscription.entity';
import { Invoice } from './entities/invoice.entity';
import { Pixel } from './entities/pixel.entity';
import { PixelEvent } from './entities/pixel-event.entity';
import { Notification } from './entities/notification.entity';
import { UserNotification } from './entities/user-notification.entity';
import { ScheduleModule } from '@nestjs/schedule';
import { ZenviaModule } from './zenvia/zenvia.module';
import { TwilioModule } from './twilio/twilio.module';
import { UserUsage } from './entities/user-usage.entity';
import { WebhooksModule } from './webhooks/webhooks.module';
import { SystemSettingsModule } from './system-settings/system-settings.module';
import { CategoriesModule } from './categories/categories.module';
import { UploadsModule } from './uploads/uploads.module';
import { AdminModule } from './admin/admin.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { TwilioConnectionsModule } from './twilio-connections/twilio-connections.module';
import { KnowledgeBaseModule } from './knowledge-base/knowledge-base.module';
import { BotFlowsModule } from './bot-flows/bot-flows.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env', // Especificar explicitamente o caminho do .env
    }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        type: 'mysql',
        host: configService.get<string>('DB_HOST') || 'localhost',
        port: configService.get<number>('DB_PORT') || 3306,
        username: configService.get<string>('DB_USERNAME') || 'root',
        password: configService.get<string>('DB_PASSWORD') || '',
        database: configService.get<string>('DB_DATABASE') || 'nucleo_crm',
        entities: [__dirname + '/**/*.entity{.ts,.js}'],
        synchronize: false, // Alterar para false em produção
        migrations: ['dist/migrations/*.js'],
        migrationsRun: false, // Executar migrations manualmente via npm run migration:run
      }),
      inject: [ConfigService],
    }),
    AuthModule,
    UsersModule,
    ProductsModule,
    SalesModule,
    ContactsModule,
    ContactPurchasesModule,
    GroupsModule,
    TagsModule,
    ScoreConfigModule,
    EmailModule,
    EmailConnectionsModule,
    ShopifyModule,
    NuvemshopModule,
    VtexModule,
    CampaignsModule,
    SubscriptionsModule,
    PixelsModule,
    ZenviaModule,
    TwilioModule,
    ReferralsModule,
    WebhooksModule,
    SystemSettingsModule,
    NotificationsModule,
    CategoriesModule,
    UploadsModule,
    AdminModule,
    LojaIntegradaModule,
    AnalyticsModule,
    TwilioConnectionsModule,
    TicketsModule,
    TrayModule,
    KnowledgeBaseModule,
    BotFlowsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
