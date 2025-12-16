import {
  IsNumber,
  IsOptional,
  Min,
} from 'class-validator';

export class UpdateScoreConfigDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  emailOpens?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  linkClicks?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  purchases?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  ltvDivisor?: number;
}

