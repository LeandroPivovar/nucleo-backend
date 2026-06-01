import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateBotFlowDto {
  @IsString()
  @IsOptional()
  @MaxLength(150)
  name?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
