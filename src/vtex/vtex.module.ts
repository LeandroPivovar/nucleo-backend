import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VtexController } from './vtex.controller';
import { VtexService } from './vtex.service';
import { VtexConnection } from '../entities/vtex-connection.entity';
import { Product } from '../entities/product.entity';
import { Sale } from '../entities/sale.entity';
import { Contact } from '../entities/contact.entity';

@Module({
  imports: [TypeOrmModule.forFeature([VtexConnection, Product, Sale, Contact])],
  controllers: [VtexController],
  providers: [VtexService],
  exports: [VtexService],
})
export class VtexModule {}

