import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PixelsService } from './pixels.service';
import { PixelsController } from './pixels.controller';
import { Pixel } from '../entities/pixel.entity';
import { PixelEvent } from '../entities/pixel-event.entity';
import { Product } from '../entities/product.entity';
import { Sale } from '../entities/sale.entity';
import { SalesModule } from '../sales/sales.module';
import { ContactsModule } from '../contacts/contacts.module';

@Module({
    imports: [TypeOrmModule.forFeature([Pixel, PixelEvent, Product, Sale]), SalesModule, ContactsModule],
    controllers: [PixelsController],
    providers: [PixelsService],
    exports: [PixelsService],
})
export class PixelsModule { }
