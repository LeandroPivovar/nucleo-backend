import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NuvemshopController } from './nuvemshop.controller';
import { NuvemshopService } from './nuvemshop.service';
import { NuvemshopConnection } from '../entities/nuvemshop-connection.entity';
import { Contact } from '../entities/contact.entity';
import { Sale } from '../entities/sale.entity';
import { Product } from '../entities/product.entity';

@Module({
  imports: [TypeOrmModule.forFeature([NuvemshopConnection, Contact, Sale, Product])],
  controllers: [NuvemshopController],
  providers: [NuvemshopService],
  exports: [NuvemshopService],
})
export class NuvemshopModule { }


