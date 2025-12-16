import {
  IsString,
  IsNotEmpty,
  IsOptional,
} from 'class-validator';

export class CreateTagDto {
  @IsString()
  @IsNotEmpty({ message: 'Nome é obrigatório' })
  name: string;

  @IsString()
  @IsOptional()
  color?: string;
}

