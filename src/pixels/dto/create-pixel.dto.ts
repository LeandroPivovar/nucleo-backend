import { IsString, IsNotEmpty } from 'class-validator';

export class CreatePixelDto {
    @IsString()
    @IsNotEmpty()
    name: string;
}
