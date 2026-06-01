import { IsString, MinLength } from 'class-validator';

export class ConnectTelegramDto {
  @IsString()
  @MinLength(20)
  botToken: string;
}
