import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, In } from 'typeorm';
import { Campaign } from '../entities/campaign.entity';
import { UserUsage } from '../entities/user-usage.entity';
import { Contact } from '../entities/contact.entity';
import { CampaignSchedulerService } from './campaign-scheduler/campaign-scheduler.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../entities/notification.entity';

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
        private campaignSchedulerService: CampaignSchedulerService,
        private notificationsService: NotificationsService
    ) { }

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
        const campaign = this.campaignsRepository.create({
            ...campaignData,
            userId,
        });
        const savedCampaign = await this.campaignsRepository.save(campaign);

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
            this.campaignSchedulerService.processCampaign(savedCampaign).catch((err) => {
                console.error(`Failed to immediately process campaign ${savedCampaign.id}:`, err);
            });
        }

        return savedCampaign;
    }

    async update(id: number, userId: number, campaignData: Partial<Campaign>): Promise<Campaign> {
        const campaign = await this.findOne(id, userId);
        const previousStatus = campaign.status;

        Object.assign(campaign, campaignData);
        const savedCampaign = await this.campaignsRepository.save(campaign);

        // Se o status mudou para ativa através de uma atualização, dispara em background
        if (previousStatus !== 'ativa' && savedCampaign.status === 'ativa') {
            this.campaignSchedulerService.processCampaign(savedCampaign).catch((err) => {
                console.error(`Failed to immediately process campaign ${savedCampaign.id} after update:`, err);
            });
        }

        return savedCampaign;
    }

    async remove(id: number, userId: number): Promise<void> {
        const campaign = await this.findOne(id, userId);
        await this.campaignsRepository.remove(campaign);
    }

    async addContactsToCampaign(userId: number, campaignId: number, contactIds: number[]): Promise<any> {
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

        // Salvar tracking 
        if (!campaign.config) campaign.config = {};
        if (!campaign.config.manualContacts) campaign.config.manualContacts = [];

        // Evitar duplicidades lógicas se desejar, mas vamos apenas adicionar
        const existingSet = new Set(campaign.config.manualContacts);
        contacts.forEach((c: { id: number }) => existingSet.add(c.id));
        campaign.config.manualContacts = Array.from(existingSet);

        await this.campaignsRepository.save(campaign);

        // Disparar envio apenas para os contatos fornecidos
        const successCount = await this.campaignSchedulerService.executeCampaignFlow(campaign, contacts);

        return {
            success: true,
            successCount,
            message: `${successCount} mensagens enviadas para os leads adicionados.`
        };
    }

    async trackClick(id: number): Promise<Campaign> {
        const campaign = await this.campaignsRepository.findOne({ where: { id } });
        if (!campaign) {
            throw new NotFoundException(`Campanha com ID ${id} não encontrada`);
        }

        campaign.clicksCount = (Number(campaign.clicksCount) || 0) + 1;
        return this.campaignsRepository.save(campaign);
    }

    private getDateRange(period: string) {
        const endDate = new Date();
        const startDate = new Date();

        if (period === 'diario') {
            startDate.setDate(endDate.getDate() - 7); // Últimos 7 dias
        } else if (period === 'mensal') {
            startDate.setMonth(endDate.getMonth() - 6); // Últimos 6 meses
        } else {
            // semanal (padrão)
            startDate.setDate(endDate.getDate() - 7); // Também últimos 7 dias na visão diária
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
            // Group by month ('Jan', 'Fev'...)
            const monthsMap = new Map();
            const monthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

            // Initialize last 6 months
            for (let i = 5; i >= 0; i--) {
                const date = new Date();
                date.setMonth(date.getMonth() - i);
                const monthName = monthNames[date.getMonth()];
                monthsMap.set(monthName, { periodo: monthName, envios: 0, recebidos: 0, cliques: 0 });
            }

            currentCampaigns.forEach(camp => {
                const monthName = monthNames[camp.createdAt.getMonth()];
                if (monthsMap.has(monthName)) {
                    const data = monthsMap.get(monthName);
                    data.envios += camp.sentCount || 0;
                    data.recebidos += camp.deliveredCount || 0;
                    data.cliques += camp.clicksCount || 0;
                }
            });
            chartData.push(...Array.from(monthsMap.values()));

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
            // Diario = Group by Date ('01/12', '02/12'...)
            const dateMap = new Map();

            // Initialize last 7 dates
            for (let i = 6; i >= 0; i--) {
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
            opens: camp.deliveredCount || 0,
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
            whatsapp: { channel: 'whatsapp', envios: 0, recebidos: 0 },
            email: { channel: 'email', envios: 0, recebidos: 0 },
            sms: { channel: 'sms', envios: 0, recebidos: 0 }
        };

        recentMonthlyCampaigns.forEach(c => {
            if (channelPerformanceMap[c.channel]) {
                channelPerformanceMap[c.channel].envios += c.sentCount || 0;
                channelPerformanceMap[c.channel].recebidos += c.deliveredCount || 0;
            }
        });

        const channelPerformance = Object.values(channelPerformanceMap).map(p => ({
            ...p,
            taxaAbertura: p.envios > 0 ? (p.recebidos / p.envios) * 100 : 0,
            taxaEntrega: p.envios > 0 ? (p.recebidos / p.envios) * 100 : 0
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
}
