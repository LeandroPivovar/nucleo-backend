import { IsString, IsNotEmpty, Matches } from 'class-validator';

export class CreateShopifyConnectionDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-zA-Z0-9-]+\.myshopify\.com$/, {
    message: 'Formato de loja inválido. Use: sualoja.myshopify.com',
  })
  shop: string;
}

