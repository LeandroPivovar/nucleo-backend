import { IsBoolean, IsNotEmpty } from 'class-validator';

export class Toggle2faDto {
    @IsBoolean({ message: 'Valor deve ser booleano' })
    @IsNotEmpty({ message: 'Status é obrigatório' })
    enabled: boolean;
}
