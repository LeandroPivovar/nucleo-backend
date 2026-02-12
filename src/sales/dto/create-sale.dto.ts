import { IsNumber, IsString, IsOptional, Min } from 'class-validator';

export class CreateSaleDto {
  @IsNumber()
  @Min(1)
  productId: number;

  @IsNumber()
  @Min(1)
  quantity: number;

  @IsOptional()
  @IsString()
  customerName?: string;

  @IsOptional()
  @IsString()
  customerEmail?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsNumber()
  unitPrice?: number;

  @IsOptional()
  @IsNumber()
  totalValue?: number;

  @IsOptional()
  @IsString()
  channel?: string;

  @IsOptional()
  @IsNumber()
  contactId?: number;
}

