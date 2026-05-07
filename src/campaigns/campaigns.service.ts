import { Injectable, NotFoundException, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, In } from 'typeorm';
import { Campaign } from '../entities/campaign.entity';
import { UserUsage } from '../entities/user-usage.entity';
import { Contact } from '../entities/contact.entity';
import { CampaignSchedulerService } from './campaign-scheduler/campaign-scheduler.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../entities/notification.entity';
import { ShopifyConnection } from '../entities/shopify-connection.entity';
import { NuvemshopConnection } from '../entities/nuvemshop-connection.entity';
import { CampaignClick } from '../entities/campaign-click.entity';
import { CampaignCoupon } from '../entities/campaign-coupon.entity';
import { User } from '../entities/user.entity';
import { CampaignMessageEvent } from '../entities/campaign-message-event.entity';
import * as Twilio from 'twilio';
import { TwilioService } from '../twilio/twilio.service';
import { TwilioConnectionsService } from '../twilio-connections/twilio-connections.service';
import { AdminCampaignTemplate } from '../entities/admin-campaign-template.entity';

@Injectable()
export class CampaignsService {
    private readonly logger = new Logger(CampaignsService.name);

    constructor(
        @InjectRepository(Campaign)
        private campaignsRepository: Repository<Campaign>,
        @InjectRepository(UserUsage)
        private userUsageRepository: Repository<UserUsage>,
        @InjectRepository(Contact)
        private contactsRepository: Repository<Contact>,
        @InjectRepository(ShopifyConnection)
        private shopifyConnectionRepository: Repository<ShopifyConnection>,
        @InjectRepository(NuvemshopConnection)
        private nuvemshopConnectionRepository: Repository<NuvemshopConnection>,
        @InjectRepository(CampaignClick)
        private campaignClicksRepository: Repository<CampaignClick>,
        @InjectRepository(CampaignCoupon)
        private campaignCouponRepository: Repository<CampaignCoupon>,
        @InjectRepository(User)
        private usersRepository: Repository<User>,
        @InjectRepository(CampaignMessageEvent)
        private campaignMessageEventsRepository: Repository<CampaignMessageEvent>,
        @InjectRepository(AdminCampaignTemplate)
        private adminCampaignTemplateRepository: Repository<AdminCampaignTemplate>,
        private campaignSchedulerService: CampaignSchedulerService,
        private notificationsService: NotificationsService,
        private twilioService: TwilioService,
        private twilioConnectionsService: TwilioConnectionsService,
    ) { }

    private campaignUsesWhatsapp(channel?: string, config?: any): boolean {
        if (channel === 'whatsapp') return true;
        const workflowNodes = config?.workflow?.nodes || [];
        return Array.isArray(workflowNodes) && workflowNodes.some((node: any) => node?.type === 'whatsapp');
    }

    async getTwilioTemplates(userId: number): Promise<any[]> {
        const user = await this.usersRepository.findOne({ where: { id: userId } });
        const userTemplateId = user?.templateId;

        let credentials;
        const verifiedConn = await this.twilioConnectionsService.getVerifiedConnection(userId);
        if (verifiedConn) {
            credentials = {
                accountSid: verifiedConn.accountSid,
                authToken: this.twilioService.decryptAuthToken(verifiedConn.authToken),
                whatsappFrom: verifiedConn.whatsappFrom,
            };
        }
        const templates = await this.twilioService.getTemplates(credentials);

        // 1. Filtrar por status 'approved'
        // 2. Filtrar por padrão de nome: nome_idXXXX
        // Templates sem o padrão são públicos.
        // Templates com o padrão são exclusivos do usuário com aquele templateId.
        return templates.filter(t => {
            // Se o status estiver disponível, filtrar apenas aprovados
            if (t.status && t.status.toLowerCase() !== 'approved') {
                return false;
            }

            const name = t.friendlyName || '';
            const match = name.match(/id([A-Z0-9]{4})$/i);
            if (!match) return true; // Nenhum padrão encontrado, é um template público

            // Se o padrão for encontrado, mostrar apenas se coincidir com o templateId deste usuário
            return userTemplateId && match[1].toLowerCase() === userTemplateId.toLowerCase();
        });
    }


    async getActiveCoupons(userId: number): Promise<any[]> {
        const now = new Date();
        try {
            const coupons = await this.campaignCouponRepository.createQueryBuilder('coupon')
                .innerJoin('coupon.campaign', 'campaign')
                .select('coupon.code', 'couponCode')
                .addSelect('coupon.name', 'couponName')
                .addSelect('campaign.name', 'campaignName')
                .addSelect('campaign.id', 'campaignId')
                .where('coupon.userId = :userId', { userId })
                .andWhere('campaign.status = :status', { status: 'ativa' })
                .andWhere('coupon.endsAt > :now', { now })
                .groupBy('coupon.code')
                .addGroupBy('coupon.name')
                .addGroupBy('campaign.name')
                .addGroupBy('campaign.id')
                .getRawMany();

            return coupons.map(c => ({
                name: c.couponName || c.couponCode || 'Sem nome',
                campaignName: c.campaignName,
                campaignId: c.campaignId
            }));
        } catch (error) {
            // Fallback if 'name' column doesn't exist yet (migration not run)
            this.logger.warn('Falling back to code-only query for active coupons: ' + error.message);
            const coupons = await this.campaignCouponRepository.createQueryBuilder('coupon')
                .innerJoin('coupon.campaign', 'campaign')
                .select('coupon.code', 'couponCode')
                .addSelect('campaign.name', 'campaignName')
                .addSelect('campaign.id', 'campaignId')
                .where('coupon.userId = :userId', { userId })
                .andWhere('campaign.status = :status', { status: 'ativa' })
                .andWhere('coupon.endsAt > :now', { now })
                .groupBy('coupon.code')
                .addGroupBy('campaign.name')
                .addGroupBy('campaign.id')
                .getRawMany();

            return coupons.map(c => ({
                name: c.couponCode || 'Sem nome',
                campaignName: c.campaignName,
                campaignId: c.campaignId
            }));
        }
    }

    async findAll(userId: number, filters: {
        startDate?: string;
        endDate?: string;
        minSends?: number;
        maxSends?: number;
        channel?: string;
        minRevenue?: number;
        maxRevenue?: number;
    } = {}): Promise<Campaign[]> {
        const query = this.campaignsRepository.createQueryBuilder('campaign')
            .where('campaign.userId = :userId', { userId });

        if (filters.startDate && filters.endDate) {
            query.andWhere('campaign.createdAt BETWEEN :start AND :end', {
                start: filters.startDate,
                end: filters.endDate
            });
        } else if (filters.startDate) {
            query.andWhere('campaign.createdAt >= :start', { start: filters.startDate });
        } else if (filters.endDate) {
            query.andWhere('campaign.createdAt <= :end', { end: filters.endDate });
        }

        if (filters.channel) {
            query.andWhere('campaign.channel = :channel', { channel: filters.channel });
        }

        if (filters.minSends !== undefined) {
            query.andWhere('campaign.sentCount >= :minSends', { minSends: filters.minSends });
        }
        if (filters.maxSends !== undefined) {
            query.andWhere('campaign.sentCount <= :maxSends', { maxSends: filters.maxSends });
        }

        if (filters.minRevenue !== undefined) {
            query.andWhere('campaign.revenue >= :minRevenue', { minRevenue: filters.minRevenue });
        }
        if (filters.maxRevenue !== undefined) {
            query.andWhere('campaign.revenue <= :maxRevenue', { maxRevenue: filters.maxRevenue });
        }

        return query.orderBy('campaign.createdAt', 'DESC').getMany();
    }

    async findOne(id: number, userId: number): Promise<Campaign> {
        const campaign = await this.campaignsRepository.findOne({
            where: { id, userId },
        });

        if (!campaign) {
            throw new NotFoundException(`Campanha com ID ${id} não encontrada`);
        }

        return campaign;
    }

    async create(userId: number, campaignData: Partial<Campaign>): Promise<Campaign> {
        this.logger.log(`Criando nova campanha para o usuário ${userId}`);
        const campaign = this.campaignsRepository.create({
            ...campaignData,
            userId,
        });
        const savedCampaign = await this.campaignsRepository.save(campaign);
        this.logger.log(`Campanha salva com sucesso [ID: ${savedCampaign.id}, Status: ${savedCampaign.status}]`);

        // Track usage limit
        const currentMonthYear = new Date().toISOString().slice(0, 7);
        let usage = await this.userUsageRepository.findOne({
            where: { userId, monthYear: currentMonthYear }
        });

        if (!usage) {
            usage = this.userUsageRepository.create({
                userId,
                monthYear: currentMonthYear,
            });
        }

        usage.campaignsCreated = (Number(usage.campaignsCreated) || 0) + 1;
        await this.userUsageRepository.save(usage);

        // Immediate send if status is 'ativa', running in background
        if (savedCampaign.status === 'ativa') {
            this.logger.log(`Disparando envio imediato para a campanha [ID: ${savedCampaign.id}]`);
            this.campaignSchedulerService.processCampaign(savedCampaign).catch((err) => {
                this.logger.error(`Falha ao processar campanha [ID: ${savedCampaign.id}] imediatamente:`, err.stack);
            });
        }

        return savedCampaign;
    }

    async update(id: number, userId: number, campaignData: Partial<Campaign>): Promise<Campaign> {
        const campaign = await this.findOne(id, userId);
        const previousStatus = campaign.status;

        this.logger.log(`Atualizando campanha [ID: ${id}] para o usuário ${userId}`);
        Object.assign(campaign, campaignData);
        const savedCampaign = await this.campaignsRepository.save(campaign);

        // Se o status mudou para ativa através de uma atualização, dispara em background
        if (previousStatus !== 'ativa' && savedCampaign.status === 'ativa') {
            this.logger.log(`Status alterado para 'ativa'. Disparando envio para a campanha [ID: ${savedCampaign.id}]`);
            this.campaignSchedulerService.processCampaign(savedCampaign).catch((err) => {
                this.logger.error(`Falha ao processar campanha [ID: ${savedCampaign.id}] após atualização:`, err.stack);
            });
        }

        return savedCampaign;
    }

    async remove(id: number, userId: number): Promise<void> {
        const campaign = await this.findOne(id, userId);
        await this.campaignsRepository.remove(campaign);
    }

    async addContactsToCampaign(userId: number, campaignId: number, contactIds: number[]): Promise<any> {
        this.logger.log(`Adicionando ${contactIds?.length} contatos manualmente à campanha [ID: ${campaignId}]`);
        const campaign = await this.findOne(campaignId, userId);

        const allowedStatuses = ['ativa', 'finalizada', 'agendada'];
        if (!allowedStatuses.includes(campaign.status)) {
            throw new Error(`A campanha está com status "${campaign.status}" e não permite adição manual.`);
        }

        if (!contactIds || contactIds.length === 0) {
            throw new Error('Nenhum contato selecionado.');
        }

        const contacts = await this.contactsRepository.find({
            where: {
                userId,
                id: In(contactIds)
            }
        });

        if (contacts.length === 0) {
            throw new Error('Nenhum contato válido encontrado.');
        }

        this.logger.log(`Encontrados ${contacts.length} contatos válidos para adicionar.`);

        // Salvar tracking 
        if (!campaign.config) campaign.config = {};
        if (!campaign.config.manualContacts) campaign.config.manualContacts = [];

        // Evitar duplicidades lógicas se desejar, mas vamos apenas adicionar
        const existingSet = new Set(campaign.config.manualContacts);
        contacts.forEach((c: { id: number }) => existingSet.add(c.id));
        campaign.config.manualContacts = Array.from(existingSet);

        await this.campaignsRepository.save(campaign);

        // Disparar envio apenas para os contatos fornecidos
        this.logger.log(`Disparando executeCampaignFlow para ${contacts.length} contatos na campanha [ID: ${campaignId}]`);
        const successCount = await this.campaignSchedulerService.executeCampaignFlow(campaign, contacts);
        this.logger.log(`Envio manual finalizado. Sucesso: ${successCount}/${contacts.length}`);

        return {
            success: true,
            successCount,
            message: `${successCount} mensagens enviadas para os leads adicionados.`
        };
    }

    async trackClick(id: number, contactId?: number): Promise<Campaign> {
        const campaign = await this.campaignsRepository.findOne({ where: { id } });
        if (!campaign) {
            throw new NotFoundException(`Campanha com ID ${id} não encontrada`);
        }

        campaign.clicksCount = (Number(campaign.clicksCount) || 0) + 1;

        if (contactId) {
            try {
                // Registrar o clique individual para uso no workflow
                await this.campaignClicksRepository.save({
                    campaignId: id,
                    contactId: contactId
                });
                this.logger.debug(`Individual click recorded for campaign ${id} and contact ${contactId}`);
            } catch (error) {
                this.logger.error(`Error recording individual click: ${error.message}`);
            }
        }

        return this.campaignsRepository.save(campaign);
    }

    private getDateRange(period: string) {
        const endDate = new Date();
        const startDate = new Date();

        if (period === 'diario') {
            startDate.setHours(0, 0, 0, 0);
            endDate.setHours(23, 59, 59, 999);
        } else if (period === 'mensal') {
            startDate.setDate(endDate.getDate() - 30);
        } else {
            // semanal (padrão)
            startDate.setDate(endDate.getDate() - 7);
        }

        return { startDate, endDate };
    }

    async getDashboardPerformance(userId: number, period: string, filters: { campaignId?: number; productId?: number } = {}) {
        const { startDate, endDate } = this.getDateRange(period);

        // Fetch campaigns within period
        const query = this.campaignsRepository.createQueryBuilder('campaign')
            .where('campaign.userId = :userId', { userId })
            .andWhere('campaign.createdAt BETWEEN :startDate AND :endDate', { startDate, endDate });

        if (filters.campaignId) {
            query.andWhere('campaign.id = :campaignId', { campaignId: filters.campaignId });
        }

        const campaigns = await query.orderBy('campaign.createdAt', 'ASC').getRawMany();
        // Since we used getRawMany with QueryBuilder, the fields might need mapping if we want to use the entity directly below.
        // Actually campaignsRepository.find is easier if we don't have complex joins yet.

        const campaignsEntities = await this.campaignsRepository.find({
            where: {
                userId,
                id: filters.campaignId ? filters.campaignId : undefined,
                createdAt: Between(startDate, endDate)
            },
            order: { createdAt: 'ASC' }
        });

        // Grouping logic for the chart
        const chartData: any[] = [];
        const currentCampaigns = campaignsEntities;

        if (period === 'mensal') {
            // Group by Date for last 30 days
            const dateMap = new Map();
            for (let i = 29; i >= 0; i--) {
                const date = new Date(endDate);
                date.setDate(date.getDate() - i);
                const formattedDate = `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`;
                dateMap.set(formattedDate, { periodo: formattedDate, envios: 0, recebidos: 0, cliques: 0, _date: date });
            }

            currentCampaigns.forEach(camp => {
                const formattedDate = `${String(camp.createdAt.getDate()).padStart(2, '0')}/${String(camp.createdAt.getMonth() + 1).padStart(2, '0')}`;
                if (dateMap.has(formattedDate)) {
                    const data = dateMap.get(formattedDate);
                    data.envios += camp.sentCount || 0;
                    data.recebidos += camp.deliveredCount || 0;
                    data.cliques += camp.clicksCount || 0;
                }
            });
            chartData.push(...Array.from(dateMap.values()).sort((a, b) => a._date.getTime() - b._date.getTime()).map(d => {
                delete d._date;
                return d;
            }));

        } else if (period === 'semanal') {
            // Group by Day of Week ('Seg', 'Ter'...)
            const daysMap = new Map();
            const daysPT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

            // Initialize last 7 days
            for (let i = 6; i >= 0; i--) {
                const date = new Date(endDate);
                date.setDate(date.getDate() - i);
                const dayName = daysPT[date.getDay()];
                if (!daysMap.has(dayName)) {
                    daysMap.set(dayName, { periodo: dayName, envios: 0, recebidos: 0, cliques: 0, _date: date });
                }
            }

            currentCampaigns.forEach(camp => {
                const dayName = daysPT[camp.createdAt.getDay()];
                if (daysMap.has(dayName)) {
                    const data = daysMap.get(dayName);
                    data.envios += camp.sentCount || 0;
                    data.recebidos += camp.deliveredCount || 0;
                    data.cliques += camp.clicksCount || 0;
                }
            });
            chartData.push(...Array.from(daysMap.values()).sort((a, b) => a._date.getTime() - b._date.getTime()).map(d => {
                delete d._date;
                return d;
            }));

        } else {
            // Diario (Hoje) = Just 1 point for today
            const dateMap = new Map();
            const date = new Date(endDate);
            const formattedDate = `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`;
            dateMap.set(formattedDate, { periodo: formattedDate, envios: 0, recebidos: 0, cliques: 0, _date: date });

            currentCampaigns.forEach(camp => {
                const formattedDateCamp = `${String(camp.createdAt.getDate()).padStart(2, '0')}/${String(camp.createdAt.getMonth() + 1).padStart(2, '0')}`;
                if (dateMap.has(formattedDateCamp)) {
                    const data = dateMap.get(formattedDateCamp);
                    data.envios += camp.sentCount || 0;
                    data.recebidos += camp.deliveredCount || 0;
                    data.cliques += camp.clicksCount || 0;
                }
            });
            chartData.push(...Array.from(dateMap.values()).map(d => {
                delete d._date;
                return d;
            }));
        }

        // Recent Campaigns (last 5)
        const recentCampaignsDb = await this.campaignsRepository.find({
            where: {
                userId,
                id: filters.campaignId ? filters.campaignId : undefined
            },
            order: { createdAt: 'DESC' },
            take: 5
        });

        const recentCampaigns = recentCampaignsDb.map(camp => ({
            name: camp.name,
            type: camp.channel === 'email' ? 'E-mail' : camp.channel === 'sms' ? 'SMS' : 'WhatsApp',
            status: camp.status === 'ativa' ? 'Ativa' : camp.status === 'pausada' ? 'Pausada' : camp.status === 'agendada' ? 'Agendada' : camp.status === 'finalizada' ? 'Finalizada' : 'Rascunho',
            sent: camp.sentCount || 0,
            recebidos: camp.deliveredCount || 0,
            clicks: camp.clicksCount || 0
        }));

        // Recent Activities (filtered if campaignId provided)
        const recentActivity: any[] = [];

        // 1. New Campaigns Created
        const newCampaigns = await this.campaignsRepository.find({
            where: {
                userId,
                id: filters.campaignId ? filters.campaignId : undefined
            },
            order: { createdAt: 'DESC' },
            take: 1
        });
        newCampaigns.forEach(c => {
            recentActivity.push({
                title: 'Nova campanha criada',
                subtitle: `${c.name}`,
                timestamp: c.createdAt,
                type: 'campaign_created'
            });
        });

        // 2. Finished Campaigns
        const finishedCampaigns = await this.campaignsRepository.find({
            where: {
                userId,
                status: 'finalizada',
                id: filters.campaignId ? filters.campaignId : undefined
            },
            order: { updatedAt: 'DESC' },
            take: 1
        });
        finishedCampaigns.forEach(c => {
            recentActivity.push({
                title: 'Campanha finalizada',
                subtitle: `${c.name}`,
                timestamp: c.updatedAt,
                type: 'campaign_finished'
            });
        });

        // 3. Imported Contacts (Skip if campaignId provided for now, as contacts aren't linked to campaigns at import time usually)
        if (!filters.campaignId) {
            const recentContacts = await this.contactsRepository.find({
                where: { userId },
                order: { createdAt: 'DESC' },
                take: 5
            });

            if (recentContacts.length > 0) {
                recentActivity.push({
                    title: 'Novos contatos adicionados',
                    subtitle: `${recentContacts.length} contatos recentes na plataforma`,
                    timestamp: recentContacts[0].createdAt,
                    type: 'contacts_added'
                });
            }
        }

        recentActivity.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

        // Channel Performance (last 30 days)
        const date30DaysAgo = new Date();
        date30DaysAgo.setDate(date30DaysAgo.getDate() - 30);

        const recentMonthlyCampaigns = await this.campaignsRepository.find({
            where: {
                userId,
                createdAt: Between(date30DaysAgo, new Date()),
                id: filters.campaignId ? filters.campaignId : undefined
            }
        });

        const channelPerformanceMap: Record<string, any> = {
            whatsapp: { channel: 'whatsapp', envios: 0, recebidos: 0, receita: 0 },
            email: { channel: 'email', envios: 0, recebidos: 0, receita: 0 },
            sms: { channel: 'sms', envios: 0, recebidos: 0, receita: 0 },
            manual: { channel: 'manual', envios: 0, recebidos: 0, receita: 0 }
        };

        recentMonthlyCampaigns.forEach(c => {
            if (channelPerformanceMap[c.channel]) {
                channelPerformanceMap[c.channel].envios += c.sentCount || 0;
                channelPerformanceMap[c.channel].recebidos += c.deliveredCount || 0;
                channelPerformanceMap[c.channel].receita += Number(c.revenue) || 0;
            }
        });

        const channelPerformance = Object.values(channelPerformanceMap).map(p => ({
            ...p,
            taxaEntrega: p.envios > 0 ? Math.min((p.recebidos / p.envios) * 100, 100) : 0
        }));

        return {
            chartData,
            recentCampaigns,
            recentActivity,
            channelPerformance
        };
    }

    async handleDeliveredWebhook(payload: any): Promise<void> {
        try {
            const statusCode: string = payload?.messageStatus?.code;
            if (statusCode !== 'DELIVERED') {
                return; // Apenas processa eventos DELIVERED
            }

            const channel: string = payload?.channel; // 'sms' | 'email'
            const messageId: string = payload?.messageId || payload?.message?.id;

            this.logger.log(`Webhook DELIVERED recebido - canal: ${channel}, messageId: ${messageId}`);

            // Localiza a campanha mais recente ativa/finalizada no canal correspondente
            // Como o webhook não carrega campaignId, incrementamos a campanha mais recente do canal
            const campaign = await this.campaignsRepository.findOne({
                where: { channel },
                order: { updatedAt: 'DESC' },
            });

            if (!campaign) {
                this.logger.warn(`Nenhuma campanha encontrada para o canal ${channel}`);
                return;
            }

            await this.campaignsRepository.update(campaign.id, {
                deliveredCount: () => 'deliveredCount + 1',
            } as any);

            this.logger.log(`deliveredCount incrementado na campanha [ID: ${campaign.id}] - canal: ${channel}`);
        } catch (error: any) {
            this.logger.error(`Erro ao processar webhook de entrega: ${error.message}`);
        }
    }

    async handleTwilioStatusWebhook(
        payload: any,
        query: { campaignId?: string; contactId?: string },
        requestContext?: { fullUrl?: string; signature?: string },
    ): Promise<void> {
        try {
            const messageStatus = String(payload?.MessageStatus || payload?.SmsStatus || '').toLowerCase();
            const campaignId = Number(query?.campaignId);
            const contactId = Number(query?.contactId);
            const messageSid = payload?.MessageSid || payload?.SmsSid;

            if (!campaignId || Number.isNaN(campaignId)) {
                this.logger.warn(`[TWILIO WEBHOOK] campaignId inválido. status=${messageStatus}, sid=${messageSid || 'N/A'}`);
                return;
            }

            this.logger.log(`[TWILIO WEBHOOK] campaign=${campaignId}, contact=${contactId || 'N/A'}, status=${messageStatus}, sid=${messageSid || 'N/A'}`);

            const campaign = await this.campaignsRepository.findOne({ where: { id: campaignId } });
            if (!campaign) {
                this.logger.warn(`[TWILIO WEBHOOK] Campanha ${campaignId} não encontrada.`);
                return;
            }

            // Identificar o token correto: Subconta verificada ou Global (.env)
            let authToken = '';
            const verifiedConn = await this.twilioConnectionsService.getVerifiedConnection(campaign.userId);
            
            if (verifiedConn) {
                authToken = this.twilioService.decryptAuthToken(verifiedConn.authToken);
                this.logger.debug(`[TWILIO WEBHOOK] Usando token da subconta verificada para o usuário ${campaign.userId}`);
            } else {
                authToken = this.twilioService.getGlobalAuthToken();
                this.logger.debug(`[TWILIO WEBHOOK] Usando token global (.env)`);
            }

            const signature = requestContext?.signature || '';
            const requestUrl = requestContext?.fullUrl || '';

            if (!authToken || !signature || !requestUrl) {
                this.logger.warn(`[TWILIO WEBHOOK] Contexto insuficiente para validação (Token: ${!!authToken}, Sig: ${!!signature}, URL: ${!!requestUrl}). campaign=${campaignId}`);
                return;
            }

            const signatureValid = Twilio.validateRequest(authToken, signature, requestUrl, payload || {});
            const signatureValidWithHttpsFallback = requestUrl.startsWith('http://')
                ? Twilio.validateRequest(authToken, signature, requestUrl.replace('http://', 'https://'), payload || {})
                : false;

            if (!signatureValid && !signatureValidWithHttpsFallback) {
                this.logger.warn(`[TWILIO WEBHOOK] Assinatura inválida para campanha ${campaignId}.`);
                return;
            }

            // Contabiliza entrega somente quando o provedor marca como delivered.
            if (messageStatus !== 'delivered') {
                return;
            }

            if (messageSid) {
                try {
                    await this.campaignMessageEventsRepository.save({
                        campaignId,
                        contactId: Number.isNaN(contactId) ? undefined : contactId,
                        messageSid,
                        status: messageStatus,
                        provider: 'twilio',
                    });
                } catch (error: any) {
                    if (error?.code === 'ER_DUP_ENTRY') {
                        this.logger.warn(`[TWILIO WEBHOOK] MessageSid duplicado ignorado: ${messageSid}`);
                        return;
                    }
                    throw error;
                }
            }

            await this.campaignsRepository.update(campaignId, {
                deliveredCount: () => 'deliveredCount + 1',
            } as any);
        } catch (error: any) {
            this.logger.error(`Erro ao processar webhook de status Twilio: ${error.message}`);
        }
    }

    async checkAndNotifyPerformance(userId: number) {
        try {
            // Verificar se o usuário deseja receber notificações de campanhas
            const isEnabled = await this.notificationsService.isPreferenceEnabled(userId, NotificationType.CAMPAIGN);
            if (!isEnabled) return;

            // Buscar campanhas finalizadas nas últimas 48 horas
            const twoDaysAgo = new Date();
            twoDaysAgo.setHours(twoDaysAgo.getHours() - 48);

            const finishedCampaigns = await this.campaignsRepository.find({
                where: {
                    userId,
                    status: 'finalizada',
                    updatedAt: Between(twoDaysAgo, new Date())
                },
                order: { updatedAt: 'DESC' }
            });

            for (const camp of finishedCampaigns) {
                const title = `📊 Desempenho: ${camp.name}`;

                // Verificar se já existe uma notificação para esta campanha específica
                const alreadyNotified = await this.notificationsService.exists(
                    userId,
                    NotificationType.CAMPAIGN,
                    title
                );

                if (!alreadyNotified) {
                    const openRate = camp.sentCount > 0 ? ((camp.deliveredCount / camp.sentCount) * 100).toFixed(1) : '0';
                    const clickRate = camp.sentCount > 0 ? ((camp.clicksCount / camp.sentCount) * 100).toFixed(1) : '0';

                    await this.notificationsService.create({
                        userId,
                        title,
                        message: `Sua campanha "${camp.name}" foi finalizada com sucesso!\n\n` +
                            `✅ Envios: ${camp.sentCount}\n` +
                            `📬 Recebidos: ${camp.deliveredCount} (${openRate}%)\n` +
                            `🖱️ Cliques: ${camp.clicksCount} (${clickRate}%)\n` +
                            (camp.revenue > 0 ? `💰 Receita: R$ ${camp.revenue}\n` : '') +
                            `Consulte o relatório detalhado no menu de Campanhas.`,
                        type: NotificationType.CAMPAIGN,
                    });

                    this.logger.log(`Performance notification created for user ${userId} (campaign ${camp.id})`);
                }
            }
        } catch (error) {
            console.error(`Error checking campaign performance for user ${userId}:`, error);
        }
    }

    async handleIntegrationWebhook(source: string, headers: any, payload: any): Promise<void> {
        try {
            let userId: number | null = null;
            let internalEventType: string | null = null;
            let customerEmail: string | null = null;
            let customerPhone: string | null = null;
            let customerName: string = 'Contato Loja';
            let orderValue: string | null = null;
            let products: any[] = [];

            // 1. Identify Tenant and Normalize Event
            if (source === 'shopify') {
                const shopDomain = headers['x-shopify-shop-domain'];
                const topic = headers['x-shopify-topic']; // e.g., orders/create, carts/update

                if (!shopDomain || !topic) return;

                const connection = await this.shopifyConnectionRepository.findOne({ where: { shop: shopDomain } });
                if (!connection) return;
                userId = connection.userId;

                if (topic === 'orders/create') {
                    internalEventType = 'order_placed';
                    if (payload.financial_status === 'paid') internalEventType = 'order_delivered';
                } else if (topic === 'orders/cancelled') {
                    internalEventType = 'order_cancelled';
                } else if (topic === 'checkouts/create' || topic === 'checkouts/update') {
                    internalEventType = 'cart_abandoned'; // Simplify mapping for demo
                }

                customerEmail = payload.email || payload.customer?.email;
                customerPhone = payload.phone || payload.customer?.phone;
                customerName = payload.customer?.first_name || 'Contato Shopify';
                orderValue = payload.total_price;
                products = payload.line_items || [];

            } else if (source === 'nuvemshop') {
                // Nuvemshop doesn't always send the store id in headers, it might be in payload or header x-linked-store-id
                const storeId = payload.store_id || headers['x-linked-store-id'];
                const event = payload.event; // e.g. order/created, order/paid

                if (!storeId || !event) return;

                const connection = await this.nuvemshopConnectionRepository.findOne({ where: { storeId: storeId.toString() } });
                if (!connection) return;
                userId = connection.userId;

                if (event === 'order/created') internalEventType = 'order_placed';
                else if (event === 'order/paid') internalEventType = 'order_delivered';
                else if (event === 'order/cancelled') internalEventType = 'order_cancelled';
                else if (event.startsWith('cart/')) internalEventType = 'cart_abandoned';

                customerEmail = payload.customer?.email;
                customerPhone = payload.customer?.phone;
                customerName = payload.customer?.name || 'Contato Nuvemshop';
                orderValue = payload.total;
                products = payload.products || [];
            }

            if (!userId || !internalEventType || (!customerEmail && !customerPhone)) {
                return;
            }

            // 2. Find or Create Contact
            let contact = await this.contactsRepository.findOne({
                where: customerEmail ? { userId, email: customerEmail } : { userId, phone: customerPhone || '' }
            });

            if (!contact) {
                contact = this.contactsRepository.create({
                    userId,
                    email: customerEmail || '',
                    phone: customerPhone || '',
                    name: customerName,
                    source,
                    status: 'customer'
                });
                await this.contactsRepository.save(contact);
            }

            // 3. Find Active Campaigns and trigger
            const activeCampaigns = await this.campaignsRepository.find({
                where: { userId, status: 'ativa' }
            });

            for (const campaign of activeCampaigns) {
                if (campaign.complexity !== 'advanced') continue;

                const nodes = campaign.config?.workflow?.nodes || [];

                // Find a ConditionNode matching this event type
                const matchingConditionNode = nodes.find((n: any) =>
                    n.type === 'condition' && n.data?.conditionType === internalEventType
                );

                if (matchingConditionNode) {
                    this.logger.log(`Campaign ${campaign.id} triggered by ${internalEventType} for contact ${contact.id}`);

                    // Build event context
                    const eventContext = {
                        eventType: internalEventType,
                        value: orderValue,
                        products: products.map((p: any) => ({ name: p.name || p.title, sku: p.sku, id: p.id || p.product_id }))
                    };

                    // Pass execution to Scheduler passing the specific matching node as start point
                    await this.campaignSchedulerService.executeCampaignFlowFromNode(campaign, [contact], matchingConditionNode, eventContext);
                }
            }


        } catch (error: any) {
            this.logger.error(`Error handling integration webhook: ${error.message}`);
        }
    }

    async getPublicAdminTemplates(): Promise<AdminCampaignTemplate[]> {
        return this.adminCampaignTemplateRepository.find({
            where: { status: 'publicada' },
            order: { createdAt: 'DESC' },
        });
    }
}
