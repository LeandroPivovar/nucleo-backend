import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SalesService } from './sales.service';
import { SalesController } from './sales.controller';
import { Sale } from '../entities/sale.entity';
import { Product } from '../entities/product.entity';
import { Campaign } from '../entities/campaign.entity';
import { Contact } from '../entities/contact.entity';
import { PixelEvent } from '../entities/pixel-event.entity';
import { ShopifyModule } from '../shopify/shopify.module';
import { NuvemshopModule } from '../nuvemshop/nuvemshop.module';
import { LojaIntegradaModule } from '../loja-integrada/loja-integrada.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Sale, Product, Campaign, Contact, PixelEvent]),
    ShopifyModule,
    NuvemshopModule,
    LojaIntegradaModule,
  ],
  controllers: [SalesController],
  providers: [SalesService],
  exports: [SalesService],
})
export class SalesModule { }

