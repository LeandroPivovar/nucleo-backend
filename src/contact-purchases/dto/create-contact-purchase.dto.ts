import {
  IsNumber,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsDateString,
  Min,
} from 'class-validator';

export class CreateContactPurchaseDto {
  @IsNumber()
  @IsNotEmpty({ message: 'ID do contato é obrigatório' })
  contactId: number;

  @IsNumber()
  @IsOptional()
  productId?: number;

  @IsNumber()
  @IsNotEmpty({ message: 'Valor é obrigatório' })
  @Min(0.01, { message: 'Valor deve ser maior que zero' })
  value: number;

  @IsNumber()
  @IsOptional()
  @Min(1, { message: 'Quantidade deve ser maior que zero' })
  quantity?: number;

  @IsString()
  @IsOptional()
  productName?: string;

  @IsString()
  @IsOptional()
  paymentMethod?: string;

  @IsString()
  @IsOptional()
  status?: string;

  @IsDateString()
  @IsNotEmpty({ message: 'Data da compra é obrigatória' })
  purchaseDate: string;
}

