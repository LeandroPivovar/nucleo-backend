import { DataSource } from 'typeorm';
import { config } from 'dotenv';
import { User } from '../entities/user.entity';
import { Product } from '../entities/product.entity';
import { Sale } from '../entities/sale.entity';
import { Contact } from '../entities/contact.entity';
import { ContactPurchase } from '../entities/contact-purchase.entity';
import { ContactTag } from '../entities/contact-tag.entity';
import { ContactSegmentation } from '../entities/contact-segmentation.entity';
import { Group } from '../entities/group.entity';
import { Tag } from '../entities/tag.entity';
import { ScoreConfig } from '../entities/score-config.entity';
import { PasswordReset } from '../entities/password-reset.entity';
import { EmailVerification } from '../entities/email-verification.entity';
import { EmailConnection } from '../entities/email-connection.entity';
import { Campaign } from '../entities/campaign.entity';
import { Plan } from '../entities/plan.entity';
import { Subscription } from '../entities/subscription.entity';
import { Invoice } from '../entities/invoice.entity';
import { Pixel } from '../entities/pixel.entity';
import { PixelEvent } from '../entities/pixel-event.entity';
import { Referral } from '../entities/referral.entity';
import { ReferralCommission } from '../entities/referral-commission.entity';
import { UserUsage } from '../entities/user-usage.entity';
import { Category } from '../entities/category.entity';
import { Notification } from '../entities/notification.entity';
import { UserNotification } from '../entities/user-notification.entity';
import { ShopifyConnection } from '../entities/shopify-connection.entity';
import { NuvemshopConnection } from '../entities/nuvemshop-connection.entity';
import { VtexConnection } from '../entities/vtex-connection.entity';
import { LoginAttempt } from '../entities/login-attempt.entity';
import { NotificationPreference } from '../entities/notification-preference.entity';
import { SystemSetting } from '../entities/system-setting.entity';
import { WebhookLog } from '../entities/webhook-log.entity';
import { InternalAnalytics } from '../entities/internal-analytics.entity';
import { CampaignMessageEvent } from '../entities/campaign-message-event.entity';
import { Ticket } from '../entities/ticket.entity';
import { TicketMessage } from '../entities/ticket-message.entity';

config();

export const AppDataSource = new DataSource({
  type: 'mysql',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306'),
  username: process.env.DB_USERNAME || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_DATABASE || 'nucleo_crm',
  entities: [
    User,
    Product,
    Sale,
    Contact,
    ContactPurchase,
    ContactTag,
    ContactSegmentation,
    Group,
    Tag,
    ScoreConfig,
    PasswordReset,
    EmailVerification,
    EmailConnection,
    Campaign,
    Plan,
    Subscription,
    Invoice,
    Pixel,
    PixelEvent,
    Referral,
    ReferralCommission,
    UserUsage,
    Category,
    Notification,
    UserNotification,
    ShopifyConnection,
    NuvemshopConnection,
    VtexConnection,
    LoginAttempt,
    NotificationPreference,
    SystemSetting,
    WebhookLog,
    InternalAnalytics,
    CampaignMessageEvent,
    Ticket,
    TicketMessage
  ],
  migrations: ['src/migrations/*.ts'],
  synchronize: false,
  logging: true,
});
