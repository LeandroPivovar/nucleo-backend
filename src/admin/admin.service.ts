import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan, Between, Not } from 'typeorm';
import { User } from '../entities/user.entity';
import { Subscription } from '../entities/subscription.entity';
import { Plan } from '../entities/plan.entity';
import { Invoice } from '../entities/invoice.entity';
import { Sale } from '../entities/sale.entity';

import { Contact } from '../entities/contact.entity';
import { Campaign } from '../entities/campaign.entity';
import { UserUsage } from '../entities/user-usage.entity';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

export interface MonthlyFinanceData {
    month: string;
    monthFull: string;
    subscriptionRevenue: number;
    oneTimeRevenue: number;
    totalRevenue: number;
    costs: number;
    netProfit: number;
    margin: number;
}

export interface ProjectionData {
    month: string;
    revenue: number;
    profit: number;
}


@Injectable()
export class AdminService {
    constructor(
        @InjectRepository(User)
        private usersRepository: Repository<User>,
        @InjectRepository(Subscription)
        private subscriptionRepository: Repository<Subscription>,
        @InjectRepository(Plan)
        private planRepository: Repository<Plan>,
        @InjectRepository(Invoice)
        private invoiceRepository: Repository<Invoice>,
        @InjectRepository(Sale)
        private saleRepository: Repository<Sale>,
        @InjectRepository(Contact)
        private contactRepository: Repository<Contact>,
        @InjectRepository(Campaign)
        private campaignRepository: Repository<Campaign>,
        @InjectRepository(UserUsage)
        private usageRepository: Repository<UserUsage>,
        private jwtService: JwtService,
    ) { }

    async getUserStats(userId: number) {
        const user = await this.usersRepository.findOne({
            where: { id: userId },
            relations: ['plan'],
        });

        if (!user) throw new Error('Usuário não encontrado');

        const salesResult = await this.saleRepository
            .createQueryBuilder('sale')
            .select('SUM(sale.totalValue)', 'total')
            .where('sale.userId = :userId', { userId })
            .getRawOne();

        const billingAmount = parseFloat(salesResult?.total || '0');
        const contactsCount = await this.contactRepository.count({ where: { userId } });
        const campaignsCount = await this.campaignRepository.count({ where: { userId } });

        const now = new Date();
        const monthYear = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const usage = await this.usageRepository.findOne({
            where: { userId, monthYear },
        });

        return {
            billingAmount,
            contactsCount,
            campaignsCount,
            usage: {
                emailsSent: usage?.emailsSent || 0,
                smsSent: usage?.smsSent || 0,
                whatsappSent: usage?.whatsappSent || 0,
            },
            subscription: {
                planName: user.plan?.name || 'Sem plano',
                status: user.subscriptionStatus || 'Inativo',
                createdAt: user.createdAt,
            }
        };
    }

    async resetUserPassword(userId: number, newPassword?: string) {
        const user = await this.usersRepository.findOne({ where: { id: userId } });
        if (!user) throw new Error('Usuário não encontrado');

        const tempPassword = newPassword || Math.random().toString(36).slice(-8);
        user.password = await bcrypt.hash(tempPassword, 10);
        await this.usersRepository.save(user);

        return { tempPassword };
    }

    async addCredits(userId: number, type: 'email' | 'sms', amount: number) {
        const user = await this.usersRepository.findOne({ where: { id: userId } });
        if (!user) throw new Error('Usuário não encontrado');

        if (type === 'email') {
            user.extraEmailsBalance = (user.extraEmailsBalance || 0) + amount;
        } else if (type === 'sms') {
            user.extraSmsBalance = (user.extraSmsBalance || 0) + amount;
        }

        await this.usersRepository.save(user);
        return {
            extraEmailsBalance: user.extraEmailsBalance,
            extraSmsBalance: user.extraSmsBalance,
        };
    }

    async impersonateUser(userId: number) {
        const user = await this.usersRepository.findOne({ where: { id: userId } });
        if (!user) throw new Error('Usuário não encontrado');

        const token = this.jwtService.sign({ sub: user.id, email: user.email });
        return { token };
    }

    async getGlobalStats() {
        const now = new Date();
        const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const last30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        const last60d = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

        console.log('Fetching Admin Global Stats...');

        // 1. DAU / MAU (Approx via updatedAt)
        const dau = await this.usersRepository.count({
            where: { updatedAt: MoreThan(last24h) },
        });
        console.log('DAU:', dau);

        const mau = await this.usersRepository.count({
            where: { updatedAt: MoreThan(last30d) },
        });
        console.log('MAU:', mau);

        // 2. Active Companies
        const activeCompanies = await this.usersRepository.count({
            where: { subscriptionStatus: 'ACTIVE' },
        });
        console.log('Active Companies:', activeCompanies);

        // 3. MRR Calculation
        const activeSubscriptions = await this.subscriptionRepository.find({
            where: { status: 'active' },
            relations: ['plan'],
        });
        console.log('Active Subscriptions:', activeSubscriptions.length);

        let mrr = 0;
        activeSubscriptions.forEach((sub) => {
            const price = Number(sub.plan?.price) || 0;
            if (sub.plan?.interval === 'yearly') {
                mrr += price / 12;
            } else {
                mrr += price;
            }
        });

        // 4. Growth (MoM) - Using Revenue approximation
        const prevMonthInvoices = await this.invoiceRepository.find({
            where: {
                createdAt: Between(last60d, last30d),
                status: 'paid',
            },
        });
        const currMonthInvoices = await this.invoiceRepository.find({
            where: {
                createdAt: MoreThan(last30d),
                status: 'paid',
            },
        });

        const prevRevenue = prevMonthInvoices.reduce((acc, inv) => acc + Number(inv.amount), 0);
        const currRevenue = currMonthInvoices.reduce((acc, inv) => acc + Number(inv.amount), 0);
        const growthMoM = prevRevenue > 0 ? ((currRevenue - prevRevenue) / prevRevenue) * 100 : 0;

        // 5. Churn Rate
        const canceledInLast30d = await this.subscriptionRepository.count({
            where: {
                status: 'canceled',
                updatedAt: MoreThan(last30d),
            },
        });
        const totalActiveAtStart = activeSubscriptions.length + canceledInLast30d;
        const churnRate = totalActiveAtStart > 0 ? (canceledInLast30d / totalActiveAtStart) * 100 : 0;

        // 6. Default Rate (Inadimplência)
        const openInvoices30d = await this.invoiceRepository.find({
            where: {
                createdAt: MoreThan(last30d),
                status: 'open',
            },
        });
        const paidInvoices30d = currMonthInvoices;

        const openAmount = openInvoices30d.reduce((acc, inv) => acc + Number(inv.amount), 0);
        const paidAmount = paidInvoices30d.reduce((acc, inv) => acc + Number(inv.amount), 0);
        const totalInvoiced = openAmount + paidAmount;
        const defaultRate = totalInvoiced > 0 ? (openAmount / totalInvoiced) * 100 : 0;

        // 7. LTV Médio
        const allPaidInvoices = await this.invoiceRepository.find({ where: { status: 'paid' } });
        const totalPaidAmount = allPaidInvoices.reduce((acc, inv) => acc + Number(inv.amount), 0);
        const uniquePayingUsers = new Set(allPaidInvoices.map(inv => inv.userId)).size;
        const averageLtv = uniquePayingUsers > 0 ? totalPaidAmount / uniquePayingUsers : 0;

        // 8. Ticket Médio por Plano
        const plans = await this.planRepository.find({ where: { active: true } });
        const ticketByPlan = {};
        for (const plan of plans) {
            const planSubs = activeSubscriptions.filter(s => s.planId === plan.id);
            const planTotal = planSubs.length > 0 ? planSubs.reduce((acc, s) => acc + Number(s.plan.price), 0) : 0;
            ticketByPlan[plan.name] = planSubs.length > 0 ? planTotal / planSubs.length : 0;
        }

        return {
            dau,
            mau,
            activeCompanies,
            mrr,
            growthMoM,
            churnRate,
            defaultRate,
            averageLtv,
            cac: 50, // Mock fixed value for now
            ticketByPlan,
        };
    }

    // --- Plan Management ---
    async getAllPlans() {
        return this.planRepository.find({ order: { price: 'ASC' } });
    }

    async createPlan(data: Partial<Plan>) {
        const plan = this.planRepository.create(data);
        return this.planRepository.save(plan);
    }

    async updatePlan(id: number, data: Partial<Plan>) {
        await this.planRepository.update(id, data);
        return this.planRepository.findOne({ where: { id } });
    }

    async deletePlan(id: number) {
        // We could do a soft delete or just de-activate
        // Let's do a real delete for now, or de-activate?
        // Usually it's better to just de-activate to avoid breaking existing subscriptions' relations
        await this.planRepository.update(id, { active: false });
        return { success: true };
    }

    async getFinanceStats() {
        const now = new Date();
        const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);

        // 1. Get all relevant data (last year)
        const invoices = await this.invoiceRepository.find({
            where: {
                createdAt: MoreThan(twelveMonthsAgo),
                status: 'paid'
            }
        });

        // 2. Aggregate by month
        const monthlyData: MonthlyFinanceData[] = [];
        for (let i = 0; i < 12; i++) {
            const date = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
            const monthName = date.toLocaleString('pt-BR', { month: 'short' });
            const year = date.getFullYear();
            const startOfMonth = new Date(year, date.getMonth(), 1);
            const endOfMonth = new Date(year, date.getMonth() + 1, 0);

            const monthInvoices = invoices.filter(inv => inv.createdAt >= startOfMonth && inv.createdAt <= endOfMonth);

            // subscriptionRevenue: where subscriptionId is present
            // oneTimeRevenue: where subscriptionId is null (credit purchases)
            const subRevenue = monthInvoices
                .filter(inv => inv.subscriptionId !== null && inv.subscriptionId !== undefined)
                .reduce((acc, inv) => acc + Number(inv.amount), 0);

            const creditRevenue = monthInvoices
                .filter(inv => inv.subscriptionId === null || inv.subscriptionId === undefined)
                .reduce((acc, inv) => acc + Number(inv.amount), 0);

            const totalRevenue = subRevenue + creditRevenue;

            // Estimated costs (approx 30%)
            const estCosts = totalRevenue * 0.3;
            const netProfit = totalRevenue - estCosts;

            monthlyData.push({
                month: monthName,
                monthFull: `${monthName}/${year}`,
                subscriptionRevenue: subRevenue,
                oneTimeRevenue: creditRevenue,
                totalRevenue,
                costs: estCosts,
                netProfit,
                margin: totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0
            });
        }

        // 3. Current MRR and Growth
        // (Reuse logic from getGlobalStats but simplified)
        const activeSubs = await this.subscriptionRepository.find({
            where: { status: 'active' },
            relations: ['plan']
        });

        let currentMrr = 0;
        activeSubs.forEach(sub => {
            const price = Number(sub.plan?.price) || 0;
            currentMrr += sub.plan?.interval === 'yearly' ? price / 12 : price;
        });

        // 4. Projections (Simple linear projection)
        const projections: ProjectionData[] = [];
        // Calculate average growth rate from last 3 months
        const last3Months = monthlyData.slice(-3);
        let avgGrowth = 0.05; // Default 5% if data is scarce
        if (last3Months.length >= 2) {
            const growth1 = last3Months[0].totalRevenue > 0 ? (last3Months[1].totalRevenue - last3Months[0].totalRevenue) / last3Months[0].totalRevenue : 0.05;
            const growth2 = last3Months[1].totalRevenue > 0 ? (last3Months[2].totalRevenue - last3Months[1].totalRevenue) / last3Months[1].totalRevenue : 0.05;
            avgGrowth = (growth1 + growth2) / 2;
        }

        let projectedRevenue = monthlyData.length > 0 ? monthlyData[monthlyData.length - 1].totalRevenue : 0;
        for (let i = 1; i <= 6; i++) {
            const date = new Date(now.getFullYear(), now.getMonth() + i, 1);
            projectedRevenue = projectedRevenue * (1 + avgGrowth);
            projections.push({
                month: date.toLocaleString('pt-BR', { month: 'short' }),
                revenue: projectedRevenue,
                profit: projectedRevenue * 0.7 // Assuming fixed margin
            });
        }

        return {
            monthlyData,
            projections,
            currentMrr,
            ytdRevenue: monthlyData.reduce((acc, d) => acc + d.totalRevenue, 0),
            avgMargin: monthlyData.reduce((acc, d) => acc + d.margin, 0) / monthlyData.length,
            growthRate: avgGrowth * 100
        };
    }
}
