import { IsEmail, IsNotEmpty, IsString, Length } from 'class-validator';

export class Verify2faDto {
    @IsEmail({}, { message: 'E-mail inválido' })
    @IsNotEmpty({ message: 'E-mail é obrigatório' })
    email: string;

    @IsString({ message: 'Código deve ser uma string' })
    @IsNotEmpty({ message: 'Código é obrigatório' })
    @Length(6, 6, { message: 'Código deve ter 6 dígitos' })
    code: string;
}
