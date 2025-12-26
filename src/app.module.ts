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
import { EmailConnection } from './entities/email-connection.entity';
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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env', // Especificar explicitamente o caminho do .env
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        type: 'mysql',
        host: configService.get<string>('DB_HOST') || 'localhost',
        port: configService.get<number>('DB_PORT') || 3306,
        username: configService.get<string>('DB_USERNAME') || 'root',
        password: configService.get<string>('DB_PASSWORD') || '',
        database: configService.get<string>('DB_DATABASE') || 'nucleo_crm',
        entities: [User, Product, Sale, Contact, ContactPurchase, ContactTag, ContactSegmentation, Group, Tag, ScoreConfig, PasswordReset, EmailVerification, EmailConnection],
        synchronize: false, // Usar migrations ao invés de synchronize
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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
