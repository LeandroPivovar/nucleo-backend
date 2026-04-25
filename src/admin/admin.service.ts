import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan, Between, Not } from 'typeorm';
import { User } from '../entities/user.entity';
import { Subscription } from '../entities/subscription.entity';
import { Plan } from '../entities/plan.entity';
import { Invoice } from '../entities/invoice.entity';
import { Sale } from '../entities/sale.entity';

import { Contact } from '../entities/contact.entity';
import { EmailConnection } from '../entities/email-connection.entity';
import { Notification, NotificationType } from '../entities/notification.entity';
import { Campaign } from '../entities/campaign.entity';
import { UserUsage } from '../entities/user-usage.entity';
import { SystemSetting } from '../entities/system-setting.entity';
import { JwtService } from '@nestjs/jwt';
import { Category } from '../entities/category.entity';
import { InternalAnalytics } from '../entities/internal-analytics.entity';
import { ShopifyConnection } from '../entities/shopify-connection.entity';
import { NuvemshopConnection } from '../entities/nuvemshop-connection.entity';
import { VtexConnection } from '../entities/vtex-connection.entity';
import { LojaIntegradaConnection } from '../entities/loja-integrada-connection.entity';
import { CampaignClick } from '../entities/campaign-click.entity';
import { Product } from '../entities/product.entity';
import { TemplateRequest, TemplateRequestStatus } from '../entities/template-request.entity';
import { AdminCampaignTemplate } from '../entities/admin-campaign-template.entity';
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
        @InjectRepository(EmailConnection)
        private emailConnectionRepository: Repository<EmailConnection>,
        @InjectRepository(Notification)
        private notificationRepository: Repository<Notification>,
        @InjectRepository(Category)
        private categoryRepository: Repository<Category>,
        @InjectRepository(InternalAnalytics)
        private analyticsRepository: Repository<InternalAnalytics>,
        @InjectRepository(ShopifyConnection)
        private shopifyConnectionRepository: Repository<ShopifyConnection>,
        @InjectRepository(NuvemshopConnection)
        private nuvemshopConnectionRepository: Repository<NuvemshopConnection>,
        @InjectRepository(VtexConnection)
        private vtexConnectionRepository: Repository<VtexConnection>,
        @InjectRepository(LojaIntegradaConnection)
        private liConnectionRepository: Repository<LojaIntegradaConnection>,
        @InjectRepository(CampaignClick)
        private campaignClickRepository: Repository<CampaignClick>,
        @InjectRepository(Product)
        private productRepository: Repository<Product>,
        @InjectRepository(TemplateRequest)
        private templateRequestRepository: Repository<TemplateRequest>,
        @InjectRepository(AdminCampaignTemplate)
        private adminCampaignTemplateRepository: Repository<AdminCampaignTemplate>,
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

    async addCredits(userId: number, type: 'email' | 'sms' | 'whatsapp', amount: number) {
        const user = await this.usersRepository.findOne({ where: { id: userId } });
        if (!user) throw new Error('Usuário não encontrado');

        if (type === 'email') {
            user.extraEmailsBalance = (user.extraEmailsBalance || 0) + amount;
        } else if (type === 'sms') {
            user.extraSmsBalance = (user.extraSmsBalance || 0) + amount;
        } else if (type === 'whatsapp') {
            user.extraWhatsappBalance = (user.extraWhatsappBalance || 0) + amount;
        }

        await this.usersRepository.save(user);
        return {
            extraEmailsBalance: user.extraEmailsBalance,
            extraSmsBalance: user.extraSmsBalance,
            extraWhatsappBalance: user.extraWhatsappBalance,
        };
    }

    async impersonateUser(userId: number) {
        const user = await this.usersRepository.findOne({ where: { id: userId }, relations: ['plan'] });
        if (!user) throw new Error('Usuário não encontrado');

        const token = this.jwtService.sign({ sub: user.id, email: user.email });
        const { password, ...userWithoutPassword } = user;
        return { token, user: userWithoutPassword };
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

    async getFinanceStats(days = 365) {
        const now = new Date();
        const startOfPeriod = new Date();
        startOfPeriod.setDate(now.getDate() - days);
        startOfPeriod.setHours(0, 0, 0, 0);

        // 1. Get Settings for Costs
        const costSmsSetting = await this.systemSettingRepository.findOne({ where: { key: 'COST_SMS' } });
        const costEmailSetting = await this.systemSettingRepository.findOne({ where: { key: 'COST_EMAIL' } });
        const costSms = parseFloat(costSmsSetting?.value || '0.05');
        const costEmail = parseFloat(costEmailSetting?.value || '0.01');

        // 2. Get all relevant data (period)
        const invoices = await this.invoiceRepository.find({
            where: {
                createdAt: MoreThan(startOfPeriod),
                status: 'paid'
            }
        });

        const usages = await this.usageRepository.find({
            where: {
                createdAt: MoreThan(startOfPeriod)
            }
        });

        // 3. Aggregate by month
        const monthsCount = Math.ceil(days / 28); // Approximation to handle different month lengths
        const monthlyData: MonthlyFinanceData[] = [];
        for (let i = 0; i < monthsCount; i++) {
            const date = new Date(now.getFullYear(), now.getMonth() - (monthsCount - 1 - i), 1);
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
    async getCapacityStats() {
        const now = new Date();
        const monthYear = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const dayOfMonth = now.getDate();
        const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        const daysRemaining = daysInMonth - dayOfMonth;

        // 1. Get Provider Limits
        const emailLimitSetting = await this.systemSettingRepository.findOne({ where: { key: 'PROVIDER_EMAIL_LIMIT' } });
        const smsLimitSetting = await this.systemSettingRepository.findOne({ where: { key: 'PROVIDER_SMS_LIMIT' } });
        const whatsappLimitSetting = await this.systemSettingRepository.findOne({ where: { key: 'PROVIDER_WHATSAPP_LIMIT' } });

        const providerEmailLimit = parseInt(emailLimitSetting?.value || '1000000');
        const providerSmsLimit = parseInt(smsLimitSetting?.value || '100000');
        const providerWhatsappLimit = parseInt(whatsappLimitSetting?.value || '50000');

        // 2. Calculate Current Consumption (Total Platform)
        const usageResult = await this.usageRepository
            .createQueryBuilder('usage')
            .select('SUM(usage.emailsSent)', 'emails')
            .addSelect('SUM(usage.smsSent)', 'sms')
            .addSelect('SUM(usage.whatsappSent)', 'whatsapp')
            .where('usage.monthYear = :monthYear', { monthYear })
            .getRawOne();

        const consumedEmail = parseInt(usageResult?.emails || '0');
        const consumedSms = parseInt(usageResult?.sms || '0');
        const consumedWhatsapp = parseInt(usageResult?.whatsapp || '0');

        // 3. Calculate Total Contracted by Clients
        const activeSubs = await this.subscriptionRepository.find({
            where: { status: 'active' },
            relations: ['plan']
        });

        let clientsEmailsContracted = 0;
        let clientsSmsContracted = 0;
        let clientsWhatsappContracted = 0;

        activeSubs.forEach(sub => {
            clientsEmailsContracted += sub.plan?.limits?.emails || 0;
            clientsSmsContracted += sub.plan?.limits?.sms || 0;
            clientsWhatsappContracted += sub.plan?.limits?.whatsapp ? (sub.plan?.limits?.whatsappLimit || 0) : 0;
        });

        const extraBalances = await this.usersRepository
            .createQueryBuilder('user')
            .select('SUM(user.extraEmailsBalance)', 'emails')
            .addSelect('SUM(user.extraSmsBalance)', 'sms')
            .getRawOne();

        clientsEmailsContracted += parseInt(extraBalances?.emails || '0');
        clientsSmsContracted += parseInt(extraBalances?.sms || '0');

        // 4. Calculations & Projections
        const calculateStats = (consumed: number, providerLimit: number, clientsContracted: number) => {
            const usagePercent = providerLimit > 0 ? (consumed / providerLimit) * 100 : 0;
            const dailyAvg = dayOfMonth > 0 ? consumed / dayOfMonth : 0;
            const projection = dailyAvg * daysInMonth;
            const marginOfSafety = providerLimit - projection;
            const isAlert = projection > providerLimit;

            return {
                consumed,
                providerLimit,
                clientsContracted,
                usagePercent,
                daysRemaining,
                projection,
                marginOfSafety,
                isAlert
            };
        };

        return {
            email: calculateStats(consumedEmail, providerEmailLimit, clientsEmailsContracted),
            sms: calculateStats(consumedSms, providerSmsLimit, clientsSmsContracted),
            whatsapp: calculateStats(consumedWhatsapp, providerWhatsappLimit, clientsWhatsappContracted)
        };
    }

    async getPendingEmailConnections() {
        return this.emailConnectionRepository.find({
            where: { status: 'pending' },
            relations: ['user'],
            order: { createdAt: 'DESC' }
        });
    }

    async approveEmailConnection(id: number) {
        const connection = await this.emailConnectionRepository.findOne({
            where: { id },
            relations: ['user']
        });
        if (!connection) throw new Error('Conexão de e-mail não encontrada');

        connection.status = 'verified';
        await this.emailConnectionRepository.save(connection);

        // Criar notificação para o usuário
        const notification = this.notificationRepository.create({
            userId: connection.userId,
            title: 'Domínio de E-mail Aprovado',
            message: `O domínio ${connection.domain} foi verificado e já pode ser utilizado para envios.`,
            type: NotificationType.SUCCESS,
        });
        await this.notificationRepository.save(notification);

        return connection;
    }

    async rejectEmailConnection(id: number, adminNote: string) {
        const connection = await this.emailConnectionRepository.findOne({ where: { id } });
        if (!connection) throw new Error('Conexão de e-mail não encontrada');

        connection.status = 'rejected';
        connection.adminNote = adminNote;
        await this.emailConnectionRepository.save(connection);

        // Criar notificação para o usuário
        const notification = this.notificationRepository.create({
            userId: connection.userId,
            title: 'Domínio de E-mail Rejeitado',
            message: `O domínio ${connection.domain} não pôde ser verificado. Motivo: ${adminNote}`,
            type: NotificationType.ERROR,
        });
        await this.notificationRepository.save(notification);

        return connection;
    }

    async getSystemOverviewStats() {
        const [
            contactsCount,
            campaignsCount,
            categoriesCount,
            trackingLinksCount, // Counting CampaignClicks as a proxy for link interaction or simply total campaign setups
            shopifyCount,
            nuvemshopCount,
            vtexCount,
            liCount,
        ] = await Promise.all([
            this.contactRepository.count(),
            this.campaignRepository.count(),
            this.categoryRepository.count(),
            this.campaignClickRepository.count(),
            this.shopifyConnectionRepository.count(),
            this.nuvemshopConnectionRepository.count(),
            this.vtexConnectionRepository.count(),
            this.liConnectionRepository.count(),
        ]);

        const usageStats = await this.usageRepository.createQueryBuilder('usage')
            .select('SUM(usage.emailsSent)', 'emails')
            .addSelect('SUM(usage.smsSent)', 'sms')
            .getRawOne();

        const topPages = await this.analyticsRepository.createQueryBuilder('event')
            .select('event.name', 'name')
            .addSelect('COUNT(event.id)', 'count')
            .where('event.type = :type', { type: 'page_view' })
            .groupBy('event.name')
            .orderBy('count', 'DESC')
            .limit(10)
            .getRawMany();

        const topActions = await this.analyticsRepository.createQueryBuilder('event')
            .select('event.name', 'name')
            .addSelect('COUNT(event.id)', 'count')
            .where('event.type = :type', { type: 'action' })
            .groupBy('event.name')
            .orderBy('count', 'DESC')
            .limit(10)
            .getRawMany();

        return {
            counts: {
                contacts: contactsCount,
                campaigns: campaignsCount,
                categories: categoriesCount,
                trackingLinks: trackingLinksCount,
                integrations: Number(shopifyCount) + Number(nuvemshopCount) + Number(vtexCount) + Number(liCount),
                emailsSent: Number(usageStats?.emails || 0),
                smsSent: Number(usageStats?.sms || 0),
            },
            integrationsBreakdown: {
                shopify: shopifyCount,
                nuvemshop: nuvemshopCount,
                vtex: vtexCount,
                lojaIntegrada: liCount,
            },
            topPages,
            topActions,
        };
    }

    async getDailyEventStats(days = 30) {
        const date = new Date();
        date.setDate(date.getDate() - days);

        const stats = await this.analyticsRepository.createQueryBuilder('event')
            .select('DATE(event.timestamp)', 'date')
            .addSelect('COUNT(event.id)', 'count')
            .where('event.timestamp >= :date', { date })
            .groupBy('DATE(event.timestamp)')
            .orderBy('date', 'ASC')
            .getRawMany();

        return stats.map(s => ({
            date: s.date,
            count: Number(s.count),
        }));
    }

    // --- Template Requests Management ---
    async getTemplateRequests() {
        return this.templateRequestRepository.find({
            where: { status: Not(TemplateRequestStatus.PENDING_PAYMENT) },
            relations: ['user'],
            order: { createdAt: 'DESC' }
        });
    }

    async approveTemplateRequest(id: number, adminNote?: string) {
        const req = await this.templateRequestRepository.findOne({
            where: { id },
            relations: ['user']
        });
        if (!req) throw new Error('Solicitação de template não encontrada');

        req.status = TemplateRequestStatus.CREATED;
        if (adminNote) req.adminNote = adminNote;
        await this.templateRequestRepository.save(req);

        // Criar notificação
        const notification = this.notificationRepository.create({
            userId: req.userId,
            title: 'Template de WhatsApp Criado',
            message: `Sua solicitação de template foi processada e já deve estar disponível na seleção de templates. Motivo/Nota: ${adminNote || 'Aprovado'}`,
            type: NotificationType.SUCCESS,
        });
        await this.notificationRepository.save(notification);

        return req;
    }

    async rejectTemplateRequest(id: number, adminNote: string) {
        const req = await this.templateRequestRepository.findOne({
            where: { id },
            relations: ['user']
        });
        if (!req) throw new Error('Solicitação de template não encontrada');

        req.status = TemplateRequestStatus.REJECTED;
        req.adminNote = adminNote;
        await this.templateRequestRepository.save(req);

        // Criar notificação
        const notification = this.notificationRepository.create({
            userId: req.userId,
            title: 'Template de WhatsApp Rejeitado',
            message: `Sua solicitação de template não pôde ser criada. Motivo: ${adminNote}`,
            type: NotificationType.ERROR,
        });
        await this.notificationRepository.save(notification);

        return req;
    }

    // ─── Generate Test Account ────────────────────────────────────────────────
    async generateTestAccount(level: 'low' | 'medium' | 'high') {
        // --- Volume config per level ---
        const config = {
            low: { contacts: 50, campaigns: 3, sales: 30, minPrice: 50, maxPrice: 800 },
            medium: { contacts: 300, campaigns: 10, sales: 200, minPrice: 80, maxPrice: 2000 },
            high: { contacts: 1000, campaigns: 30, sales: 1000, minPrice: 100, maxPrice: 5000 },
        }[level];

        const uid = Math.random().toString(36).slice(2, 10);
        const email = `teste.${uid}@demo.nucleocrm.com.br`;
        const plainPassword = 'Teste@123';
        const hashedPassword = await bcrypt.hash(plainPassword, 10);

        // --- STEP 1: Create User ---
        const firstNames = ['Ana', 'Carlos', 'Fernanda', 'Rafael', 'Juliana', 'Marcos', 'Camila', 'Lucas', 'Patrícia', 'Bruno'];
        const lastNames = ['Silva', 'Oliveira', 'Santos', 'Costa', 'Pereira', 'Alves', 'Rodrigues', 'Gomes', 'Martins', 'Ferreira'];
        const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
        const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];

        const user = this.usersRepository.create({
            firstName,
            lastName,
            email,
            password: hashedPassword,
            active: true,
            subscriptionStatus: 'ACTIVE',
            referralCode: `DEMO${uid.toUpperCase()}`,
        });
        const savedUser = await this.usersRepository.save(user);
        const userId = savedUser.id;

        // --- STEP 2: Create Products ---
        const productNames = [
            'Camiseta Premium', 'Tênis Esportivo', 'Mochila Urbana', 'Relógio Clássico',
            'Óculos de Sol', 'Bolsa Feminina', 'Calça Jeans', 'Jaqueta de Couro',
            'Perfume Importado', 'Notebook Ultrafino', 'Fone Bluetooth', 'Smartwatch',
        ];
        const productsToCreate = productNames.slice(0, Math.min(6, productNames.length));
        const savedProducts: Product[] = [];
        for (const name of productsToCreate) {
            const price = parseFloat((Math.random() * (config.maxPrice - config.minPrice) + config.minPrice).toFixed(2));
            const prod = this.productRepository.create({
                name,
                description: `Produto fake gerado para conta de demonstração. Nível: ${level}`,
                price,
                stock: Math.floor(Math.random() * 500) + 50,
                sku: `DEMO-${uid.toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
                active: true,
                userId,
            });
            const sp = await this.productRepository.save(prod);
            savedProducts.push(sp);
        }

        // --- STEP 3: Create Contacts ---
        const contactFirstNames = [
            'Maria', 'João', 'Ana', 'Pedro', 'Luisa', 'Ricardo', 'Beatriz', 'Felipe', 'Sandra', 'André',
            'Juliana', 'Fernando', 'Paula', 'Rodrigo', 'Tânia', 'Gustavo', 'Cláudia', 'Thiago', 'Mariana', 'Leonardo',
        ];
        const contactLastNames = [
            'Almeida', 'Barbosa', 'Carvalho', 'Dias', 'Fonseca', 'Guimarães', 'Henriques', 'Ives', 'Junqueira', 'Krause',
            'Lima', 'Melo', 'Neto', 'Orsi', 'Pinto', 'Queiroz', 'Ramos', 'Sousa', 'Torres', 'Vargas',
        ];
        const contactSources = ['website', 'referral', 'social_media', 'email', 'ads', 'organic'];
        const contactStatuses = ['active', 'lead', 'customer', 'inactive'];
        const states = ['SP', 'RJ', 'MG', 'RS', 'PR', 'SC', 'BA', 'GO', 'PE', 'CE'];
        const cities: Record<string, string[]> = {
            SP: ['São Paulo', 'Campinas', 'Santos', 'Ribeirão Preto'],
            RJ: ['Rio de Janeiro', 'Niterói', 'Petrópolis'],
            MG: ['Belo Horizonte', 'Uberlândia', 'Juiz de Fora'],
            RS: ['Porto Alegre', 'Caxias do Sul', 'Pelotas'],
            PR: ['Curitiba', 'Londrina', 'Maringá'],
            SC: ['Florianópolis', 'Joinville', 'Blumenau'],
            BA: ['Salvador', 'Feira de Santana'],
            GO: ['Goiânia', 'Anápolis'],
            PE: ['Recife', 'Caruaru'],
            CE: ['Fortaleza', 'Caucaia'],
        };

        const savedContacts: { id: number }[] = [];
        const batchSize = 50;
        for (let i = 0; i < config.contacts; i += batchSize) {
            const batch: Contact[] = [];
            const end = Math.min(i + batchSize, config.contacts);
            for (let j = i; j < end; j++) {
                const fn = contactFirstNames[j % contactFirstNames.length];
                const ln = contactLastNames[j % contactLastNames.length];
                const state = states[j % states.length];
                const cityList = cities[state];
                const city = cityList[j % cityList.length];
                const demoNum = `55119${String(Math.floor(Math.random() * 90000000) + 10000000)}`;
                const contactEmail = `${fn.toLowerCase()}.${ln.toLowerCase()}${j}@demo.com`;

                // random birth date between 1970 and 2000
                const birthYear = 1970 + Math.floor(Math.random() * 30);
                const birthDate = new Date(birthYear, Math.floor(Math.random() * 12), Math.floor(Math.random() * 28) + 1);

                batch.push(this.contactRepository.create({
                    name: fn,
                    lastName: ln,
                    email: contactEmail,
                    phone: demoNum,
                    status: contactStatuses[j % contactStatuses.length],
                    source: contactSources[j % contactSources.length],
                    state,
                    city,
                    birthDate,
                    gender: j % 2 === 0 ? 'M' : 'F',
                    userId,
                }));
            }
            const saved = await this.contactRepository.save(batch);
            savedContacts.push(...saved.map(c => ({ id: c.id })));
        }

        // --- STEP 4: Create Campaigns ---
        const campaignTemplates = [
            { name: 'Boas-vindas', channel: 'email' },
            { name: 'Promoção Relâmpago', channel: 'email' },
            { name: 'Recuperação de Carrinho', channel: 'email' },
            { name: 'SMS Fim de Semana', channel: 'sms' },
            { name: 'Oferta Exclusiva SMS', channel: 'sms' },
            { name: 'WhatsApp Black Friday', channel: 'whatsapp' },
            { name: 'WhatsApp Fidelização', channel: 'whatsapp' },
            { name: 'Newsletter Semanal', channel: 'email' },
            { name: 'Reativação de Clientes', channel: 'email' },
            { name: 'Flash Sale 24h', channel: 'sms' },
            { name: 'Lançamento de Produto', channel: 'email' },
            { name: 'Cashback Especial', channel: 'whatsapp' },
            { name: 'Aniversariantes', channel: 'email' },
            { name: 'Indicação de Amigos', channel: 'email' },
            { name: 'Pós-venda Satisfação', channel: 'email' },
            { name: 'Upsell Premium', channel: 'email' },
            { name: 'SMS Urgente', channel: 'sms' },
            { name: 'Promoção Verão', channel: 'email' },
            { name: 'Clube de Membros', channel: 'whatsapp' },
            { name: 'Recuperar Inativos', channel: 'sms' },
            { name: 'Dia dos Namorados', channel: 'email' },
            { name: 'Desconto Cliente VIP', channel: 'email' },
            { name: 'Notícias do Produto', channel: 'whatsapp' },
            { name: 'Queima de Estoque', channel: 'sms' },
            { name: 'Programa de Pontos', channel: 'email' },
            { name: 'Cross-sell Acessórios', channel: 'email' },
            { name: 'Recompra Automática', channel: 'email' },
            { name: 'Strike 48h', channel: 'sms' },
            { name: 'Natal Especial', channel: 'email' },
            { name: 'Ano Novo Oferta', channel: 'whatsapp' },
        ];
        const campaignStatuses = ['finalizada', 'ativa', 'pausada', 'finalizada', 'finalizada'];
        const channelTypes: Record<string, string> = { email: 'advanced', sms: 'simple', whatsapp: 'simple' };

        const savedCampaigns: { id: number }[] = [];
        for (let i = 0; i < config.campaigns; i++) {
            const template = campaignTemplates[i % campaignTemplates.length];
            const recipients = Math.floor(Math.random() * config.contacts * 0.8) + 10;
            const sent = Math.floor(recipients * (0.7 + Math.random() * 0.3));
            const delivered = Math.floor(sent * (0.85 + Math.random() * 0.14));
            const clicks = Math.floor(delivered * (0.05 + Math.random() * 0.2));
            const revenue = parseFloat((clicks * (Math.random() * 200 + 50)).toFixed(2));
            const daysAgo = Math.floor(Math.random() * 180);
            const createdDate = new Date();
            createdDate.setDate(createdDate.getDate() - daysAgo);

            const camp = this.campaignRepository.create({
                name: template.name,
                complexity: channelTypes[template.channel],
                channel: template.channel,
                status: campaignStatuses[i % campaignStatuses.length],
                recipientsCount: recipients,
                sentCount: sent,
                deliveredCount: delivered,
                clicksCount: clicks,
                revenue,
                config: { subject: `${template.name} — Demo`, body: 'Conteúdo de demonstração' },
                userId,
            });
            const saved = await this.campaignRepository.save(camp);
            savedCampaigns.push({ id: saved.id });
        }

        // --- STEP 5: Create Sales ---
        const paymentMethods = ['credit_card', 'pix', 'boleto', 'debit_card'];
        const channels = ['organic', 'email', 'sms', 'whatsapp', 'ads', 'referral'];
        const salesStatuses = ['completed', 'completed', 'completed', 'processing', 'cancelled'];

        let totalRevenue = 0;
        const batchSaleSize = 100;
        for (let i = 0; i < config.sales; i += batchSaleSize) {
            const batch: any[] = [];
            const end = Math.min(i + batchSaleSize, config.sales);
            for (let j = i; j < end; j++) {
                const product = savedProducts[j % savedProducts.length];
                const contact = savedContacts[j % savedContacts.length];
                const campaign = savedCampaigns.length > 0 ? savedCampaigns[j % savedCampaigns.length] : undefined;
                const quantity = Math.floor(Math.random() * 3) + 1;
                const unitPrice = parseFloat(product.price.toString());
                const totalValue = parseFloat((quantity * unitPrice).toFixed(2));
                totalRevenue += totalValue;

                // spread dates across last 12 months
                const daysAgo = Math.floor(Math.random() * 365);
                const saleDate = new Date();
                saleDate.setDate(saleDate.getDate() - daysAgo);

                const sale = this.saleRepository.create({
                    productId: product.id,
                    userId,
                    quantity,
                    unitPrice,
                    totalValue,
                    customerName: `Demo Cliente ${j + 1}`,
                    customerEmail: `cliente${j}@demo.com`,
                    paymentMethod: paymentMethods[j % paymentMethods.length],
                    campaignId: campaign?.id,
                    channel: channels[j % channels.length],
                    contactId: contact.id,
                    status: salesStatuses[j % salesStatuses.length],
                    externalId: `DEMO-${uid}-${j}`,
                } as any);
                (sale as any).createdAt = saleDate;
                batch.push(sale);
            }
            await this.saleRepository.save(batch as any);
        }

        return {
            userId: savedUser.id,
            email,
            password: plainPassword,
            firstName: savedUser.firstName,
            lastName: savedUser.lastName,
            level,
            summary: {
                contacts: savedContacts.length,
                campaigns: savedCampaigns.length,
                products: savedProducts.length,
                sales: config.sales,
                estimatedRevenue: totalRevenue,
            },
        };
    }

    // ─── Admin Campaign Templates ─────────────────────────────────────────────
    async getCampaignTemplates() {
        return this.adminCampaignTemplateRepository.find({
            order: { createdAt: 'DESC' },
        });
    }

    async createCampaignTemplate(data: { name: string; description?: string; workflow?: any; status?: string }) {
        const template = this.adminCampaignTemplateRepository.create({
            name: data.name,
            description: data.description,
            workflow: data.workflow || { nodes: [], edges: [] },
            status: data.status || 'rascunho',
        });
        return this.adminCampaignTemplateRepository.save(template);
    }

    async updateCampaignTemplate(id: number, data: Partial<{ name: string; description: string; workflow: any; status: string }>) {
        const template = await this.adminCampaignTemplateRepository.findOne({ where: { id } });
        if (!template) throw new Error('Template de campanha não encontrado');
        Object.assign(template, data);
        return this.adminCampaignTemplateRepository.save(template);
    }

    async deleteCampaignTemplate(id: number) {
        const template = await this.adminCampaignTemplateRepository.findOne({ where: { id } });
        if (!template) throw new Error('Template de campanha não encontrado');
        await this.adminCampaignTemplateRepository.remove(template);
        return { success: true };
    }

    async getPublicCampaignTemplates() {
        return this.adminCampaignTemplateRepository.find({
            where: { status: 'publicada' },
            order: { createdAt: 'DESC' },
        });
    }
}
