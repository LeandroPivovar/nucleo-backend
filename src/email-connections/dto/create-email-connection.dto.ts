import { IsBoolean, IsEmail, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateEmailConnectionDto {
  @IsNotEmpty()
  @IsString()
  type: 'domain';

  @IsNotEmpty()
  @IsString()
  domain: string;
}


