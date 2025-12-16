import { Module, Global } from '@nestjs/common';
import { EmailService } from './email.service';
import { EmailHelper } from './email.helper';

@Global()
@Module({
  providers: [EmailService, EmailHelper],
  exports: [EmailService, EmailHelper],
})
export class EmailModule {}

