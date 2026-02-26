import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, In } from 'typeorm';
import { Campaign } from '../entities/campaign.entity';
import { UserUsage } from '../entities/user-usage.entity';
import { Contact } from '../entities/contact.entity';
import { CampaignSchedulerService } from './campaign-scheduler/campaign-scheduler.service';

@Injectable()
export class CampaignsService {
    constructor(
        @InjectRepository(Campaign)
        private campaignsRepository: Repository<Campaign>,
        @InjectRepository(UserUsage)
        private userUsageRepository: Repository<UserUsage>,
        @InjectRepository(Contact)
        private contactsRepository: Repository<Contact>,
        private campaignSchedulerService: CampaignSchedulerService
    ) { }

    async findAll(userId: number): Promise<Campaign[]> {
        return this.campaignsRepository.find({
            where: { userId },
            order: { createdAt: 'DESC' },
        });
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

        usage.campaignsCreated += 1;
        await this.userUsageRepository.save(usage);

        // Immediate send if status is 'ativa'
        if (savedCampaign.status === 'ativa') {
            try {
                await this.campaignSchedulerService.processCampaign(savedCampaign);
            } catch (err) {
                console.error(`Failed to immediately process campaign ${savedCampaign.id}:`, err);
            }
        }

        return savedCampaign;
    }

    async update(id: number, userId: number, campaignData: Partial<Campaign>): Promise<Campaign> {
        const campaign = await this.findOne(id, userId);
        Object.assign(campaign, campaignData);
        return this.campaignsRepository.save(campaign);
    }

    async remove(id: number, userId: number): Promise<void> {
        const campaign = await this.findOne(id, userId);
        await this.campaignsRepository.remove(campaign);
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

    async getDashboardPerformance(userId: number, period: string) {
        const { startDate, endDate } = this.getDateRange(period);

        // Fetch campaigns within period
        const campaigns = await this.campaignsRepository.find({
            where: {
                userId,
                createdAt: Between(startDate, endDate)
            },
            order: { createdAt: 'ASC' }
        });

        // Grouping logic for the chart
        const chartData: any[] = [];

        if (period === 'mensal') {
            // Group by month ('Jan', 'Fev'...)
            const monthsMap = new Map();
            const monthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

            // Initialize last 6 months
            for (let i = 5; i >= 0; i--) {
                const date = new Date();
                date.setMonth(date.getMonth() - i);
                const monthName = monthNames[date.getMonth()];
                monthsMap.set(monthName, { periodo: monthName, envios: 0, aberturas: 0, cliques: 0 });
            }

            campaigns.forEach(camp => {
                const monthName = monthNames[camp.createdAt.getMonth()];
                if (monthsMap.has(monthName)) {
                    const data = monthsMap.get(monthName);
                    data.envios += camp.sentCount || 0;
                    data.aberturas += camp.opensCount || 0;
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
                    daysMap.set(dayName, { periodo: dayName, envios: 0, aberturas: 0, cliques: 0, _date: date });
                }
            }

            campaigns.forEach(camp => {
                const dayName = daysPT[camp.createdAt.getDay()];
                if (daysMap.has(dayName)) {
                    const data = daysMap.get(dayName);
                    data.envios += camp.sentCount || 0;
                    data.aberturas += camp.opensCount || 0;
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
                dateMap.set(formattedDate, { periodo: formattedDate, envios: 0, aberturas: 0, cliques: 0, _date: date });
            }

            campaigns.forEach(camp => {
                const formattedDate = `${String(camp.createdAt.getDate()).padStart(2, '0')}/${String(camp.createdAt.getMonth() + 1).padStart(2, '0')}`;
                if (dateMap.has(formattedDate)) {
                    const data = dateMap.get(formattedDate);
                    data.envios += camp.sentCount || 0;
                    data.aberturas += camp.opensCount || 0;
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
            where: { userId },
            order: { createdAt: 'DESC' },
            take: 5
        });

        const recentCampaigns = recentCampaignsDb.map(camp => ({
            name: camp.name,
            type: camp.channel === 'email' ? 'E-mail' : camp.channel === 'sms' ? 'SMS' : 'WhatsApp',
            status: camp.status === 'ativa' ? 'Ativa' : camp.status === 'pausada' ? 'Pausada' : camp.status === 'agendada' ? 'Agendada' : camp.status === 'finalizada' ? 'Finalizada' : 'Rascunho',
            sent: camp.sentCount || 0,
            opens: camp.opensCount || 0,
            clicks: camp.clicksCount || 0
        }));

        // Recent Activities
        const recentActivity: any[] = [];

        // 1. New Campaigns Created
        const newCampaigns = await this.campaignsRepository.find({
            where: { userId },
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
            where: { userId, status: 'finalizada' },
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

        // 3. Imported Contacts
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

        recentActivity.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

        // Channel Performance (last 30 days)
        const date30DaysAgo = new Date();
        date30DaysAgo.setDate(date30DaysAgo.getDate() - 30);

        const recentMonthlyCampaigns = await this.campaignsRepository.find({
            where: { userId, createdAt: Between(date30DaysAgo, new Date()) }
        });

        const channelPerformanceMap: Record<string, any> = {
            whatsapp: { channel: 'whatsapp', envios: 0, aberturas: 0 },
            email: { channel: 'email', envios: 0, aberturas: 0 },
            sms: { channel: 'sms', envios: 0, aberturas: 0 }
        };

        recentMonthlyCampaigns.forEach(c => {
            if (channelPerformanceMap[c.channel]) {
                channelPerformanceMap[c.channel].envios += c.sentCount || 0;
                channelPerformanceMap[c.channel].aberturas += c.opensCount || 0;
            }
        });

        const channelPerformance = Object.values(channelPerformanceMap).map(p => ({
            ...p,
            taxaAbertura: p.envios > 0 ? (p.aberturas / p.envios) * 100 : 0
        }));

        return {
            chartData,
            recentCampaigns,
            recentActivity,
            channelPerformance
        };
    }
}
