import { IsEmail, IsNotEmpty, IsString, Length } from 'class-validator';

export class VerifyResetCodeDto {
  @IsNotEmpty({ message: 'E-mail é obrigatório' })
  @IsEmail({}, { message: 'E-mail inválido' })
  email: string;

  @IsNotEmpty({ message: 'Código é obrigatório' })
  @IsString()
  @Length(6, 6, { message: 'Código deve ter 6 dígitos' })
  code: string;
}

