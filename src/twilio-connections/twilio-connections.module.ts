import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TwilioConnectionsService } from './twilio-connections.service';
import { TwilioConnectionsController } from './twilio-connections.controller';
import { TwilioConnection } from '../entities/twilio-connection.entity';
import { TwilioModule } from '../twilio/twilio.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([TwilioConnection]),
    TwilioModule,
  ],
  controllers: [TwilioConnectionsController],
  providers: [TwilioConnectionsService],
  exports: [TwilioConnectionsService],
})
export class TwilioConnectionsModule {}
