import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Subscription } from '../entities/subscription.entity';
import { Plan } from '../entities/plan.entity';
import { Invoice } from '../entities/invoice.entity';
import { User } from '../entities/user.entity';
import { Contact } from '../entities/contact.entity';
import { UserUsage } from '../entities/user-usage.entity';
import { Campaign } from '../entities/campaign.entity';

@Injectable()
export class SubscriptionsService {
    constructor(
        @InjectRepository(Subscription)
        private subscriptionRepository: Repository<Subscription>,
        @InjectRepository(Plan)
        private planRepository: Repository<Plan>,
        @InjectRepository(Invoice)
        private invoiceRepository: Repository<Invoice>,
        @InjectRepository(User)
        private userRepository: Repository<User>,
        @InjectRepository(Contact)
        private contactRepository: Repository<Contact>,
        @InjectRepository(UserUsage)
        private userUsageRepository: Repository<UserUsage>,
        @InjectRepository(Campaign)
        private campaignRepository: Repository<Campaign>,
    ) { }

    async getPlans(): Promise<Plan[]> {
        return this.planRepository.find({ where: { active: true } });
    }

    async getCurrentSubscription(userId: number) {
        const subscription = await this.subscriptionRepository.findOne({
            where: { userId, status: 'active' },
            relations: ['plan'],
            order: { createdAt: 'DESC' },
        });

        if (!subscription) return null;

        // Se a assinatura estiver vencida, tratar como sem plano
        const now = new Date();
        if (new Date(subscription.currentPeriodEnd) < now) {
            // Retorna com flag de expirado para o frontend distinguir
            return { ...subscription, isExpired: true, _treatAsNoPlan: true };
        }

        return { ...subscription, isExpired: false };
    }

    async getInvoices(userId: number) {
        return this.invoiceRepository.find({
            where: { userId },
            order: { createdAt: 'DESC' },
        });
    }

    async getDashboardStats(userId: number) {
        const subscription = await this.getCurrentSubscription(userId);

        // Primeiro e último dia do mês atual
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

        // Agrega diretamente da tabela campaigns — mesma fonte da tela de Campanhas
        const campaigns = await this.campaignRepository
            .createQueryBuilder('c')
            .select([
                'c.channel AS channel',
                'COALESCE(SUM(c.sentCount), 0) AS sentTotal',
                'COUNT(c.id) AS campaignCount'
            ])
            .where('c.userId = :userId', { userId })
            .andWhere('c.createdAt >= :start', { start: startOfMonth })
            .andWhere('c.createdAt <= :end', { end: endOfMonth })
            .groupBy('c.channel')
            .getRawMany();

        const totalCampaigns = await this.campaignRepository
            .createQueryBuilder('c')
            .where('c.userId = :userId', { userId })
            .andWhere('c.createdAt >= :start', { start: startOfMonth })
            .andWhere('c.createdAt <= :end', { end: endOfMonth })
            .getCount();

        const smsSent = campaigns.find(r => r.channel === 'sms')?.sentTotal || 0;
        const emailsSent = campaigns.find(r => ['email', 'e-mail'].includes(r.channel))?.sentTotal || 0;

        return {
            smsSent: Number(smsSent),
            emailsSent: Number(emailsSent),
            campaignsCreated: totalCampaigns,
            currentPlan: subscription?.plan?.name || 'Free',
            price: subscription?.plan?.price || 0,
        };
    }

    async checkout(userId: number, data: any) {
        const { planId, document, address, phone } = data;

        const user = await this.userRepository.findOne({ where: { id: userId } });
        if (!user) {
            throw new NotFoundException('Usuário não encontrado');
        }

        const plan = await this.planRepository.findOne({ where: { id: planId } });
        if (!plan) {
            throw new NotFoundException('Plano não encontrado');
        }

        // 1. Atualizar dados do cliente (address e document)
        if (document) user.document = document;
        if (address) user.address = address;
        if (phone) user.phone = phone;
        await this.userRepository.save(user);

        // 2. Cancelar as assinaturas antigas ativas
        await this.subscriptionRepository.update(
            { userId, status: 'active' },
            { status: 'canceled' }
        );

        // 3. Criar a nova assinatura ativa
        const newSubscription = this.subscriptionRepository.create({
            userId,
            planId,
            status: 'active',
            currentPeriodStart: new Date(),
            currentPeriodEnd: new Date(new Date().setMonth(new Date().getMonth() + (plan.interval === 'yearly' ? 12 : 1))),
        });
        const savedSubscription = await this.subscriptionRepository.save(newSubscription);

        // 4. Gerar Registro de Fatura
        const newInvoice = this.invoiceRepository.create({
            subscriptionId: savedSubscription.id,
            userId,
            amount: plan.price,
            status: 'paid', // Fictício p/ checkout auto-aprovado
        });
        await this.invoiceRepository.save(newInvoice);

        return { success: true, message: 'Checkout realizado com sucesso', subscription: savedSubscription };
    }

    async cancelSubscription(userId: number) {
        const subscription = await this.subscriptionRepository.findOne({
            where: { userId, status: 'active' },
            order: { createdAt: 'DESC' },
        });

        if (!subscription) {
            return { success: false, message: 'Nenhuma assinatura ativa encontrada.' };
        }

        subscription.status = 'canceled';
        await this.subscriptionRepository.save(subscription);

        return { success: true, message: 'Assinatura cancelada com sucesso. Seus benefícios ficam ativos por 30 dias.' };
    }
}
