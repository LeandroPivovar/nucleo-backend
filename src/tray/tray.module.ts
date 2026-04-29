import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TrayService } from './tray.service';
import { TrayController } from './tray.controller';
import { TrayConnection } from '../entities/tray-connection.entity';
import { User } from '../entities/user.entity';
import { Product } from '../entities/product.entity';
import { Sale } from '../entities/sale.entity';
import { Contact } from '../entities/contact.entity';
import { SystemSetting } from '../entities/system-setting.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TrayConnection,
      User,
      Product,
      Sale,
      Contact,
      SystemSetting,
    ]),
  ],
  providers: [TrayService],
  controllers: [TrayController],
  exports: [TrayService],
})
export class TrayModule {}
