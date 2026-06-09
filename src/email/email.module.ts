import { Module, Global } from '@nestjs/common';
import { EmailService } from './email.service';
import { EmailHelper } from './email.helper';
import { SmtpEmailService } from './smtp-email.service';
import { SystemSettingsModule } from '../system-settings/system-settings.module';

@Global()
@Module({
  imports: [SystemSettingsModule],
  providers: [EmailService, EmailHelper, SmtpEmailService],
  exports: [EmailService, EmailHelper, SmtpEmailService],
})
export class EmailModule { }

