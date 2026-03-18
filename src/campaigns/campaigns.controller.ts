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
    Query,
    HttpCode,
    HttpStatus,
    Res,
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

    @Get('dashboard/performance')
    getDashboardPerformance(@Request() req, @Query('period') period?: string) {
        return this.campaignsService.getDashboardPerformance(req.user.userId, period || 'semanal');
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

// Webhook público — sem autenticação JWT, recebe callbacks da Zenvia
@Controller('campaigns/webhook')
export class CampaignsWebhookController {
    constructor(private readonly campaignsService: CampaignsService) { }

    @Post('delivered')
    @HttpCode(HttpStatus.OK)
    handleDelivered(@Body() payload: any) {
        return this.campaignsService.handleDeliveredWebhook(payload);
    }
}

// Controller público para rastreamento de cliques
@Controller('campaigns/track')
export class CampaignsTrackingController {
    constructor(private readonly campaignsService: CampaignsService) { }

    @Get(':id')
    async track(
        @Param('id') id: string,
        @Res() res: any
    ) {
        try {
            const campaign = await this.campaignsService.trackClick(+id);
            const destination = campaign.config?.tracking?.destinationUrl || '/';

            if (res && typeof res.redirect === 'function') {
                return res.redirect(destination);
            }

            return { url: destination };
        } catch (error) {
            console.error('Erro no rastreamento de clique:', error);
            if (res && typeof res.redirect === 'function') {
                return res.redirect('/');
            }
            return { url: '/' };
        }
    }
}
