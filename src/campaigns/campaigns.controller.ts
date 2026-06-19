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
    ParseIntPipe,
    Req,
} from '@nestjs/common';
import { CampaignsService } from './campaigns.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('campaigns')
@UseGuards(JwtAuthGuard)
export class CampaignsController {
    constructor(private readonly campaignsService: CampaignsService) { }

    @Get('active-coupons')
    getActiveCoupons(@Request() req) {
        return this.campaignsService.getActiveCoupons(req.user.userId);
    }

    @Get('admin-templates')
    getAdminTemplates() {
        return this.campaignsService.getPublicAdminTemplates();
    }

    @Get('twilio/templates')
    getTwilioTemplates(@Request() req) {
        return this.campaignsService.getTwilioTemplates(req.user.userId);
    }

    @Get()
    findAll(
        @Request() req,
        @Query('startDate') startDate?: string,
        @Query('endDate') endDate?: string,
        @Query('minSends', new ParseIntPipe({ optional: true })) minSends?: number,
        @Query('maxSends', new ParseIntPipe({ optional: true })) maxSends?: number,
        @Query('channel') channel?: string,
        @Query('minRevenue', new ParseIntPipe({ optional: true })) minRevenue?: number,
        @Query('maxRevenue', new ParseIntPipe({ optional: true })) maxRevenue?: number,
    ) {
        return this.campaignsService.findAll(req.user.userId, {
            startDate,
            endDate,
            minSends,
            maxSends,
            channel,
            minRevenue,
            maxRevenue
        });
    }

    @Get('dashboard/performance')
    getDashboardPerformance(
        @Request() req,
        @Query('period') period?: string,
        @Query('campaignId', new ParseIntPipe({ optional: true })) campaignId?: number,
        @Query('productId', new ParseIntPipe({ optional: true })) productId?: number,
    ) {
        return this.campaignsService.getDashboardPerformance(req.user.userId, period || 'semanal', { campaignId, productId });
    }

    @Get(':id')
    findOne(@Param('id') id: string, @Request() req) {
        return this.campaignsService.findOne(+id, req.user.userId);
    }

    @Post()
    create(@Request() req, @Body() campaignData: any) {
        return this.campaignsService.create(req.user.userId, campaignData);
    }

    @Post(':id/contacts')
    addContacts(
        @Param('id') id: string,
        @Request() req,
        @Body() body: { contactIds: number[] }
    ) {
        return this.campaignsService.addContactsToCampaign(req.user.userId, +id, body.contactIds);
    }

    @Post(':id/groups')
    addGroups(
        @Param('id') id: string,
        @Request() req,
        @Body() body: { groupIds: number[] }
    ) {
        return this.campaignsService.addGroupsToCampaign(req.user.userId, +id, body.groupIds);
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

    @Post('twilio-status')
    @HttpCode(HttpStatus.OK)
    handleTwilioStatus(
        @Body() payload: any,
        @Query('campaignId') campaignId?: string,
        @Query('contactId') contactId?: string,
        @Req() req?: any,
    ) {
        const host = req?.get?.('host') || req?.headers?.host || '';
        const proto = req?.headers?.['x-forwarded-proto'] || req?.protocol || 'http';
        const fullUrl = `${proto}://${host}${req?.originalUrl || ''}`;
        const signature = req?.headers?.['x-twilio-signature'] || '';

        return this.campaignsService.handleTwilioStatusWebhook(payload, {
            campaignId: campaignId || req?.query?.campaignId,
            contactId: contactId || req?.query?.contactId,
        }, {
            fullUrl,
            signature,
        });
    }
}

// Controller público para rastreamento de cliques
@Controller('campaigns/track')
export class CampaignsTrackingController {
    constructor(private readonly campaignsService: CampaignsService) { }

    @Get(':id')
    async track(
        @Param('id') id: string,
        @Query('contactId') contactId: string,
        @Query('dest') dest: string,
        @Res() res: any
    ) {
        try {
            const campaign = await this.campaignsService.trackClick(+id, contactId ? +contactId : undefined);
            let destination = dest || campaign.config?.tracking?.destinationUrl || '/';

            // Normalizar URL de destino (garantir protocolo)
            if (destination !== '/') {
                if (!destination.startsWith('http')) {
                    destination = `https://${destination}`;
                }

                // Adicionar UTMs se configurado
                const tracking = campaign.config?.tracking;
                if (tracking) {
                    try {
                        const url = new URL(destination);
                        if (tracking.utmSource) url.searchParams.append('utm_source', tracking.utmSource);
                        if (tracking.utmMedium) url.searchParams.append('utm_medium', tracking.utmMedium);
                        if (tracking.utmCampaign) url.searchParams.append('utm_campaign', tracking.utmCampaign);
                        destination = url.toString();
                    } catch (e) {
                        console.error('Erro ao processar URL de destino com UTMs:', e);
                    }
                }
            }

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
