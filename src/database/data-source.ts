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

config();

export const AppDataSource = new DataSource({
  type: 'mysql',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306'),
  username: process.env.DB_USERNAME || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_DATABASE || 'nucleo_crm',
  entities: [User, Product, Sale, Contact, ContactPurchase, ContactTag, ContactSegmentation, Group, Tag, ScoreConfig, PasswordReset, EmailVerification, EmailConnection],
  migrations: ['src/migrations/*.ts'],
  synchronize: false,
  logging: true,
});

