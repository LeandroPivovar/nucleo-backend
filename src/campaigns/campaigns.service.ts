import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { Campaign } from '../entities/campaign.entity';

@Injectable()
export class CampaignsService {
    constructor(
        @InjectRepository(Campaign)
        private campaignsRepository: Repository<Campaign>,
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
        return this.campaignsRepository.save(campaign);
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

        return {
            chartData,
            recentCampaigns
        };
    }
}
