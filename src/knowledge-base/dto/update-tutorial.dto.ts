import { IsOptional, IsString } from 'class-validator';

export class UpdateTutorialDto {
    @IsOptional()
    @IsString()
    title?: string;
}
