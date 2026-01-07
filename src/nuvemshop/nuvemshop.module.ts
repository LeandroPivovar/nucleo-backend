import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NuvemshopController } from './nuvemshop.controller';
import { NuvemshopService } from './nuvemshop.service';
import { NuvemshopConnection } from '../entities/nuvemshop-connection.entity';

@Module({
  imports: [TypeOrmModule.forFeature([NuvemshopConnection])],
  controllers: [NuvemshopController],
  providers: [NuvemshopService],
  exports: [NuvemshopService],
})
export class NuvemshopModule {}


