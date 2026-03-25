import { IsBoolean, IsEmail, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateEmailConnectionDto {
  @IsNotEmpty()
  @IsString()
  type: 'smtp' | 'domain';

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  smtpHost?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  smtpPort?: number;

  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  @IsString()
  password?: string;

  @IsOptional()
  @IsBoolean()
  secure?: boolean;

  @IsOptional()
  @IsString()
  domain?: string;
}


