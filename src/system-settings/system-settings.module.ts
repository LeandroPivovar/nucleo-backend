import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { SystemSettingsService } from './system-settings.service';
import { SystemSettingsController } from './system-settings.controller';
import { SyncSchedulerService } from './sync-scheduler.service';
import { SystemSetting } from '../entities/system-setting.entity';
import { ShopifyConnection } from '../entities/shopify-connection.entity';
import { NuvemshopConnection } from '../entities/nuvemshop-connection.entity';
import { VtexConnection } from '../entities/vtex-connection.entity';
import { LojaIntegradaConnection } from '../entities/loja-integrada-connection.entity';
import { ShopifyModule } from '../shopify/shopify.module';
import { NuvemshopModule } from '../nuvemshop/nuvemshop.module';
import { VtexModule } from '../vtex/vtex.module';
import { LojaIntegradaModule } from '../loja-integrada/loja-integrada.module';

import { PublicSettingsController } from './public-settings.controller';

@Module({
    imports: [
      ScheduleModule.forRoot(),
      TypeOrmModule.forFeature([
        SystemSetting,
        ShopifyConnection,
        NuvemshopConnection,
        VtexConnection,
        LojaIntegradaConnection,
      ]),
      ShopifyModule,
      NuvemshopModule,
      VtexModule,
      LojaIntegradaModule,
    ],
    controllers: [SystemSettingsController, PublicSettingsController],
    providers: [SystemSettingsService, SyncSchedulerService],
    exports: [SystemSettingsService, SyncSchedulerService],
})
export class SystemSettingsModule { }
