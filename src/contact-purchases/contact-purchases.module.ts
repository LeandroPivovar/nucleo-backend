import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContactPurchasesService } from './contact-purchases.service';
import { ContactPurchasesController } from './contact-purchases.controller';
import { ContactPurchase } from '../entities/contact-purchase.entity';
import { Contact } from '../entities/contact.entity';
import { Product } from '../entities/product.entity';
import { Sale } from '../entities/sale.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ContactPurchase, Contact, Product, Sale])],
  controllers: [ContactPurchasesController],
  providers: [ContactPurchasesService],
  exports: [ContactPurchasesService],
})
export class ContactPurchasesModule {}

