import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EmailConnection } from '../entities/email-connection.entity';
import { EmailConnectionsService } from './email-connections.service';
import { EmailConnectionsController } from './email-connections.controller';

@Module({
  imports: [TypeOrmModule.forFeature([EmailConnection])],
  controllers: [EmailConnectionsController],
  providers: [EmailConnectionsService],
})
export class EmailConnectionsModule {}


