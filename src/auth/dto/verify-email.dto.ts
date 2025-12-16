import { IsNotEmpty, IsString } from 'class-validator';

export class VerifyEmailDto {
  @IsNotEmpty({ message: 'Token é obrigatório' })
  @IsString()
  token: string;
}

