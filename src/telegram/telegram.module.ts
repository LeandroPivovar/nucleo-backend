import { Module } from '@nestjs/common';
import { TelegramApiService } from './telegram-api.service';
import { TelegramTokenCrypto } from './telegram-token.crypto';

@Module({
  providers: [TelegramApiService, TelegramTokenCrypto],
  exports: [TelegramApiService, TelegramTokenCrypto],
})
export class TelegramModule {}
