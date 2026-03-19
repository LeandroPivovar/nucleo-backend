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
import { SystemSetting } from '../entities/system-setting.entity';
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
        @InjectRepository(SystemSetting)
        private systemSettingRepository: Repository<SystemSetting>,
        private jwtService: JwtService,
    ) { }

    async getSystemSettings() {
        return this.systemSettingRepository.find();
    }

    async updateSystemSetting(key: string, value: string, description?: string) {
        let setting = await this.systemSettingRepository.findOne({ where: { key } });
        if (setting) {
            setting.value = value;
            if (description) setting.description = description;
            return this.systemSettingRepository.save(setting);
        } else {
            setting = this.systemSettingRepository.create({ key, value, description });
            return this.systemSettingRepository.save(setting);
        }
    }

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

        const emailLimit = user.plan?.limits?.emails || 0;
        const smsLimit = user.plan?.limits?.sms || 0;
        const whatsappUnlimited = !!user.plan?.limits?.whatsapp;

        const emailsUsed = usage?.emailsSent || 0;
        const smsUsed = usage?.smsSent || 0;
        const whatsappUsed = usage?.whatsappSent || 0;

        const extraEmails = user.extraEmailsBalance || 0;
        const extraSms = user.extraSmsBalance || 0;

        // --- NEW: Profit Calculation ---
        const costSmsSetting = await this.systemSettingRepository.findOne({ where: { key: 'COST_SMS' } });
        const costEmailSetting = await this.systemSettingRepository.findOne({ where: { key: 'COST_EMAIL' } });
        const costSms = parseFloat(costSmsSetting?.value || '0.05');
        const costEmail = parseFloat(costEmailSetting?.value || '0.01');

        const allUsages = await this.usageRepository.find({ where: { userId } });
        const totalLifetimeEmails = allUsages.reduce((acc, u) => acc + u.emailsSent, 0);
        const totalLifetimeSms = allUsages.reduce((acc, u) => acc + u.smsSent, 0);

        const lifetimeCosts = (totalLifetimeEmails * costEmail) + (totalLifetimeSms * costSms);
        const lifetimeProfit = (billingAmount || 0) - lifetimeCosts;
        // ------------------------------

        return {
            billingAmount: billingAmount || 0,
            lifetimeProfit,
            contactsCount,
            campaignsCount,
            usage: {
                emails: {
                    used: emailsUsed,
                    contracted: emailLimit,
                    extra: extraEmails,
                    total: emailLimit + extraEmails,
                    available: Math.max(0, emailLimit + extraEmails - emailsUsed),
                },
                sms: {
                    used: smsUsed,
                    contracted: smsLimit,
                    extra: extraSms,
                    total: smsLimit + extraSms,
                    available: Math.max(0, smsLimit + extraSms - smsUsed),
                },
                whatsapp: {
                    used: whatsappUsed,
                    unlimited: whatsappUnlimited,
                },
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

    async getGlobalStats(month?: number, year?: number) {
        const now = new Date();
        const filterYear = year || now.getFullYear();
        const filterMonth = month !== undefined ? (month === 0 ? now.getMonth() + 1 : month) : now.getMonth() + 1;

        const startDate = new Date(filterYear, filterMonth - 1, 1);
        const endDate = new Date(filterYear, filterMonth, 0, 23, 59, 59);

        // Constants for standard periods (still useful for some metrics or comparison)
        const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const last30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        const last60d = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

        console.log(`Fetching Admin Global Stats for period: ${startDate.toISOString()} to ${endDate.toISOString()}...`);

        // 1. DAU / MAU (Approx via updatedAt)
        // If filtering current month, use standard DAU/MAU logic
        const isCurrentMonth = filterYear === now.getFullYear() && filterMonth === (now.getMonth() + 1);

        const dau = await this.usersRepository.count({
            where: { updatedAt: MoreThan(isCurrentMonth ? last24h : startDate) },
        });

        const mau = await this.usersRepository.count({
            where: { updatedAt: MoreThan(isCurrentMonth ? last30d : startDate) },
        });

        // 2. Active Companies (at the end of the period)
        const activeCompanies = await this.usersRepository.count({
            where: {
                subscriptionStatus: 'ACTIVE',
                createdAt: MoreThan(startDate) // This is a simplification
            },
        });

        // 3. MRR Calculation (Sum of plans of active subscriptions in the period)
        const activeSubscriptions = await this.subscriptionRepository.find({
            where: {
                status: 'active',
                createdAt: MoreThan(startDate) // This is a simplification
            },
            relations: ['plan'],
        });

        let mrr = 0;
        activeSubscriptions.forEach((sub) => {
            const price = Number(sub.plan?.price) || 0;
            if (sub.plan?.interval === 'yearly') {
                mrr += price / 12;
            } else {
                mrr += price;
            }
        });

        // 4. Growth (MoM)
        const prevMonthStart = new Date(filterYear, filterMonth - 2, 1);
        const prevMonthEnd = new Date(filterYear, filterMonth - 1, 0, 23, 59, 59);

        const prevMonthInvoices = await this.invoiceRepository.find({
            where: {
                createdAt: Between(prevMonthStart, prevMonthEnd),
                status: 'paid',
            },
        });
        const currMonthInvoices = await this.invoiceRepository.find({
            where: {
                createdAt: Between(startDate, endDate),
                status: 'paid',
            },
        });

        const prevRevenue = prevMonthInvoices.reduce((acc, inv) => acc + Number(inv.amount), 0);
        const currRevenue = currMonthInvoices.reduce((acc, inv) => acc + Number(inv.amount), 0);
        const growthMoM = prevRevenue > 0 ? ((currRevenue - prevRevenue) / prevRevenue) * 100 : 0;

        // 5. Churn Rate (Canceled in this month)
        const canceledInPeriod = await this.subscriptionRepository.count({
            where: {
                status: 'canceled',
                updatedAt: Between(startDate, endDate),
            },
        });
        const totalActiveAtStart = activeSubscriptions.length + canceledInPeriod;
        const churnRate = totalActiveAtStart > 0 ? (canceledInPeriod / totalActiveAtStart) * 100 : 0;

        // 6. Default Rate (Inadimplência in this month)
        const openInvoicesInPeriod = await this.invoiceRepository.find({
            where: {
                createdAt: Between(startDate, endDate),
                status: 'open',
            },
        });
        const paidInvoicesInPeriod = currMonthInvoices;

        const openAmount = openInvoicesInPeriod.reduce((acc, inv) => acc + Number(inv.amount), 0);
        const paidAmount = paidInvoicesInPeriod.reduce((acc, inv) => acc + Number(inv.amount), 0);
        const totalInvoiced = openAmount + paidAmount;
        const defaultRate = totalInvoiced > 0 ? (openAmount / totalInvoiced) * 100 : 0;

        // 7. LTV Médio (Cumulative up to end of period)
        const ltvInvoices = await this.invoiceRepository.find({
            where: {
                status: 'paid',
                createdAt: MoreThan(startDate) // Approx
            }
        });
        const totalPaidAmount = ltvInvoices.reduce((acc, inv) => acc + Number(inv.amount), 0);
        const uniquePayingUsers = new Set(ltvInvoices.map(inv => inv.userId)).size;
        const averageLtv = uniquePayingUsers > 0 ? totalPaidAmount / uniquePayingUsers : 0;

        // 8. Ticket Médio por Plano
        const plans = await this.planRepository.find({ where: { active: true } });
        const ticketByPlan = {};
        for (const plan of plans) {
            const planSubs = activeSubscriptions.filter(s => s.planId === plan.id);
            const planTotal = planSubs.length > 0 ? planSubs.reduce((acc, s) => acc + Number(s.plan.price), 0) : 0;
            ticketByPlan[plan.name] = planSubs.length > 0 ? planTotal / planSubs.length : 0;
        }

        // 9. Ticket Médio Global (Combined)
        const totalAverageTicket = activeSubscriptions.length > 0 ? mrr / activeSubscriptions.length : 0;

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
            totalAverageTicket,
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

        // 1. Get Settings for Costs
        const costSmsSetting = await this.systemSettingRepository.findOne({ where: { key: 'COST_SMS' } });
        const costEmailSetting = await this.systemSettingRepository.findOne({ where: { key: 'COST_EMAIL' } });
        const costSms = parseFloat(costSmsSetting?.value || '0.05');
        const costEmail = parseFloat(costEmailSetting?.value || '0.01');

        // 2. Get all relevant data (last year)
        const invoices = await this.invoiceRepository.find({
            where: {
                createdAt: MoreThan(twelveMonthsAgo),
                status: 'paid'
            }
        });

        const usages = await this.usageRepository.find({
            where: {
                createdAt: MoreThan(twelveMonthsAgo)
            }
        });

        // 3. Aggregate by month
        const monthlyData: MonthlyFinanceData[] = [];
        for (let i = 0; i < 12; i++) {
            const date = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
            const monthName = date.toLocaleString('pt-BR', { month: 'short' });
            const year = date.getFullYear();
            const monthKey = `${year}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            const startOfMonth = new Date(year, date.getMonth(), 1);
            const endOfMonth = new Date(year, date.getMonth() + 1, 0);

            const monthInvoices = invoices.filter(inv => inv.createdAt >= startOfMonth && inv.createdAt <= endOfMonth);
            const monthUsages = usages.filter(u => u.monthYear === monthKey);

            // subscriptionRevenue: where subscriptionId is present
            // oneTimeRevenue: where subscriptionId is null (credit purchases)
            const subRevenue = monthInvoices
                .filter(inv => inv.subscriptionId !== null && inv.subscriptionId !== undefined)
                .reduce((acc, inv) => acc + Number(inv.amount), 0);

            const creditRevenue = monthInvoices
                .filter(inv => inv.subscriptionId === null || inv.subscriptionId === undefined)
                .reduce((acc, inv) => acc + Number(inv.amount), 0);

            const totalRevenue = subRevenue + creditRevenue;

            // Calculate actual usage costs
            const totalEmails = monthUsages.reduce((acc, u) => acc + (u.emailsSent || 0), 0);
            const totalSms = monthUsages.reduce((acc, u) => acc + (u.smsSent || 0), 0);

            const usageCosts = (totalEmails * costEmail) + (totalSms * costSms);
            const baseFees = totalRevenue * 0.05; // 5% for Asaas + Taxes

            const totalCosts = usageCosts + baseFees;
            const netProfit = totalRevenue - totalCosts;

            monthlyData.push({
                month: monthName,
                monthFull: `${monthName}/${year}`,
                subscriptionRevenue: subRevenue,
                oneTimeRevenue: creditRevenue,
                totalRevenue,
                costs: totalCosts,
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

        // 5. New Detailed Reports
        // 5.1 Revenue by Plan
        const paidInvoicesDetailed = await this.invoiceRepository.find({
            where: { status: 'paid' },
            relations: ['subscription', 'subscription.plan']
        });

        const revByPlanMap: { [key: string]: number } = {};
        paidInvoicesDetailed.forEach(inv => {
            const planName = inv.subscription?.plan?.name || 'Extra/Créditos';
            revByPlanMap[planName] = (revByPlanMap[planName] || 0) + Number(inv.amount);
        });

        const revenueByPlan = Object.entries(revByPlanMap).map(([name, value]) => ({
            name,
            value
        }));

        // 5.2 Inadimplency
        const pendingInvoices = await this.invoiceRepository.find({
            where: [
                { status: 'open' },
                { status: 'past_due' },
                { status: 'uncollectible' }
            ],
            relations: ['user'],
            order: { createdAt: 'DESC' },
            take: 10
        });

        const inadimplency = {
            totalAmount: pendingInvoices.reduce((acc, inv) => acc + Number(inv.amount), 0),
            count: pendingInvoices.length,
            recentInvoices: pendingInvoices.map(inv => ({
                id: inv.id,
                userName: inv.user ? `${inv.user.firstName} ${inv.user.lastName}` : 'Usuário Desconhecido',
                amount: Number(inv.amount),
                status: inv.status,
                date: inv.createdAt
            }))
        };

        // 5.3 Cancellations by Reason
        const cancelledSubs = await this.subscriptionRepository.find({
            where: { status: 'canceled' }
        });

        const cancelReasonMap: { [key: string]: number } = {};
        cancelledSubs.forEach(sub => {
            const reason = sub.cancellationReason || 'Outros / Não Informado';
            cancelReasonMap[reason] = (cancelReasonMap[reason] || 0) + 1;
        });

        const cancellationsByReason = Object.entries(cancelReasonMap).map(([reason, count]) => ({
            reason,
            count
        }));

        return {
            monthlyData,
            projections,
            currentMrr,
            revenueByPlan,
            inadimplency,
            cancellationsByReason,
            ytdRevenue: monthlyData.reduce((acc, d) => acc + d.totalRevenue, 0),
            avgMargin: monthlyData.length > 0 ? monthlyData.reduce((acc, d) => acc + d.margin, 0) / monthlyData.length : 0,
            growthRate: avgGrowth * 100,
            settings: {
                costSms,
                costEmail
            }
        };
    }
}
