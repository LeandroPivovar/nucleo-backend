import { Module } from '@nestjs/common';
import { SystemSettingsModule } from '../system-settings/system-settings.module';
import { GeminiService } from './gemini.service';

@Module({
  imports: [SystemSettingsModule],
  providers: [GeminiService],
  exports: [GeminiService],
})
export class GeminiModule {}
