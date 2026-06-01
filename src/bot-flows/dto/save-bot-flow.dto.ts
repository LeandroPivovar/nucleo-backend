import { IsArray, IsBoolean, IsOptional } from 'class-validator';

export class SaveBotFlowDto {
  @IsArray()
  nodes: any[];

  @IsArray()
  edges: any[];

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
