import {
    Controller,
    Get,
    Post,
    Body,
    Patch,
    Param,
    Delete,
    UseGuards,
    Request,
} from '@nestjs/common';
import { CampaignsService } from './campaigns.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('campaigns')
@UseGuards(JwtAuthGuard)
export class CampaignsController {
    constructor(private readonly campaignsService: CampaignsService) { }

    @Get()
    findAll(@Request() req) {
        return this.campaignsService.findAll(req.user.userId);
    }

    @Get(':id')
    findOne(@Param('id') id: string, @Request() req) {
        return this.campaignsService.findOne(+id, req.user.userId);
    }

    @Post()
    create(@Request() req, @Body() campaignData: any) {
        return this.campaignsService.create(req.user.userId, campaignData);
    }

    @Patch(':id')
    update(
        @Param('id') id: string,
        @Request() req,
        @Body() campaignData: any,
    ) {
        return this.campaignsService.update(+id, req.user.userId, campaignData);
    }

    @Delete(':id')
    remove(@Param('id') id: string, @Request() req) {
        return this.campaignsService.remove(+id, req.user.userId);
    }
}
