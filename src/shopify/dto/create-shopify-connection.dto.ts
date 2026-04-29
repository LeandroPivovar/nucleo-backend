import { IsString, IsNotEmpty } from 'class-validator';

export class CreateShopifyConnectionDto {
  @IsString()
  @IsNotEmpty()
  shop: string;
}



