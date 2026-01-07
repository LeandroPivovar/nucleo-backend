import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VtexController } from './vtex.controller';
import { VtexService } from './vtex.service';
import { VtexConnection } from '../entities/vtex-connection.entity';

@Module({
  imports: [TypeOrmModule.forFeature([VtexConnection])],
  controllers: [VtexController],
  providers: [VtexService],
  exports: [VtexService],
})
export class VtexModule {}

