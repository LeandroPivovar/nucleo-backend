import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LojaIntegradaController } from './loja-integrada.controller';
import { LojaIntegradaService } from './loja-integrada.service';
import { LojaIntegradaConnection } from '../entities/loja-integrada-connection.entity';
import { Contact } from '../entities/contact.entity';
import { Sale } from '../entities/sale.entity';
import { Product } from '../entities/product.entity';

@Module({
    imports: [
        TypeOrmModule.forFeature([LojaIntegradaConnection, Contact, Sale, Product]),
    ],
    controllers: [LojaIntegradaController],
    providers: [LojaIntegradaService],
    exports: [LojaIntegradaService],
})
export class LojaIntegradaModule { }
