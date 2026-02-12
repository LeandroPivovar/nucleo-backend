import { IsString, IsNotEmpty, IsOptional, IsObject, IsNumber } from 'class-validator';

export class TrackEventDto {
    @IsString()
    @IsNotEmpty()
    pixel_id: string;

    @IsString()
    @IsNotEmpty()
    event: string;

    @IsOptional()
    @IsObject()
    data?: any;

    @IsOptional()
    @IsString()
    url?: string;

    @IsOptional()
    @IsString()
    sku?: string;

    @IsOptional()
    @IsString()
    content_id?: string;

    @IsOptional()
    @IsString()
    user_agent?: string;

    @IsOptional()
    @IsString()
    session_id?: string;

    @IsOptional()
    @IsString()
    page_title?: string;

    @IsOptional()
    @IsNumber()
    timestamp?: number;
}
