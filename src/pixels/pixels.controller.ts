import {
    Controller,
    Get,
    Post,
    Body,
    UseGuards,
    Request,
    Ip,
    Query,
} from '@nestjs/common';
import { PixelsService } from './pixels.service';
import { CreatePixelDto } from './dto/create-pixel.dto';
import { TrackEventDto } from './dto/track-event.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('pixels')
export class PixelsController {
    constructor(private readonly pixelsService: PixelsService) { }

    @UseGuards(JwtAuthGuard)
    @Post()
    create(@Body() createPixelDto: CreatePixelDto, @Request() req) {
        return this.pixelsService.createPixel(createPixelDto, req.user.userId);
    }

    @UseGuards(JwtAuthGuard)
    @Get()
    findAll(@Request() req) {
        return this.pixelsService.findAll(req.user.userId);
    }

    @Post('events')
    trackEvent(@Body() trackEventDto: TrackEventDto, @Ip() ip: string) {
        return this.pixelsService.trackEvent(trackEventDto, ip);
    }

    @UseGuards(JwtAuthGuard)
    @Get('metrics')
    getMetrics(@Request() req, @Query('period') period?: string) {
        return this.pixelsService.getMetrics(req.user.userId, period ? parseInt(period) : 30);
    }
}
