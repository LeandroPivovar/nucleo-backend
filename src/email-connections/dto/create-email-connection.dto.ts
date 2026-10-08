import { IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateEmailConnectionDto {
  @IsNotEmpty()
  @IsString()
  type: 'domain';

  @IsNotEmpty()
  @IsString()
  domain: string;

  @IsNotEmpty()
  @IsEmail()
  @MaxLength(255)
  email: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  senderName?: string;
}

export class UpdateEmailConnectionDto {
  @IsNotEmpty()
  @IsEmail()
  @MaxLength(255)
  email: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  senderName?: string;
}


