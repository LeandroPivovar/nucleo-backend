import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan, Between, Not } from 'typeorm';
import { User } from '../entities/user.entity';
import { Subscription } from '../entities/subscription.entity';
import { Plan } from '../entities/plan.entity';
import { Invoice } from '../entities/invoice.entity';

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
    ) { }

    async getGlobalStats() {
        const now = new Date();
        const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const last30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        const last60d = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

        // 1. DAU / MAU (Approx via updatedAt)
        const dau = await this.usersRepository.count({
            where: { updatedAt: MoreThan(last24h) },
        });
        const mau = await this.usersRepository.count({
            where: { updatedAt: MoreThan(last30d) },
        });

        // 2. Active Companies
        const activeCompanies = await this.usersRepository.count({
            where: { subscriptionStatus: 'ACTIVE' },
        });

        // 3. MRR Calculation
        const activeSubscriptions = await this.subscriptionRepository.find({
            where: { status: 'active' },
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
