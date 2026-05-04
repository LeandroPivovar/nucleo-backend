import { IsNotEmpty, IsString } from 'class-validator';

export class CreateTutorialDto {
    @IsNotEmpty({ message: 'O título é obrigatório' })
    @IsString()
    title: string;
}
