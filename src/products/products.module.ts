import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductsService } from './products.service';
import { ProductsController, ProductsImageController } from './products.controller';
import { Product } from '../entities/product.entity';
import { NuvemshopModule } from '../nuvemshop/nuvemshop.module';
import { ShopifyModule } from '../shopify/shopify.module';
import { CategoriesModule } from '../categories/categories.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Product]),
    NuvemshopModule,
    ShopifyModule,
    CategoriesModule,
  ],
  controllers: [ProductsController, ProductsImageController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule { }

