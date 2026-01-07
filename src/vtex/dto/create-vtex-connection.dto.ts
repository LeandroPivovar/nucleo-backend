import { IsString, IsNotEmpty, MinLength } from 'class-validator';

export class CreateVtexConnectionDto {
  @IsString()
  @IsNotEmpty()
  accountName: string;

  @IsString()
  @IsNotEmpty()
  appKey: string;

  @IsString()
  @IsNotEmpty()
  appToken: string;
}

