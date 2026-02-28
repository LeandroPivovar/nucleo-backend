import { Module, Global } from '@nestjs/common';
import { EmailService } from './email.service';
import { EmailHelper } from './email.helper';
import { SystemSettingsModule } from '../system-settings/system-settings.module';

@Global()
@Module({
  imports: [SystemSettingsModule],
  providers: [EmailService, EmailHelper],
  exports: [EmailService, EmailHelper],
})
export class EmailModule { }

