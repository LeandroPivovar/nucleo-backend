import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan, Between, Not } from 'typeorm';
import { User } from '../entities/user.entity';
import { Subscription } from '../entities/subscription.entity';
import { Plan } from '../entities/plan.entity';
import { Invoice } from '../entities/invoice.entity';

import { Contact } from '../entities/contact.entity';
import { Campaign } from '../entities/campaign.entity';
import { UserUsage } from '../entities/user-usage.entity';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

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

        const totalBilling = await this.invoiceRepository.find({
            where: { userId, status: 'paid' },
        });

        const billingAmount = totalBilling.reduce((acc, inv) => acc + Number(inv.amount), 0);
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
}
