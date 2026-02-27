import { Injectable, NotFoundException, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Subscription } from '../entities/subscription.entity';
import { Plan } from '../entities/plan.entity';
import { Invoice } from '../entities/invoice.entity';
import { User } from '../entities/user.entity';
import { Contact } from '../entities/contact.entity';
import { UserUsage } from '../entities/user-usage.entity';
import { Campaign } from '../entities/campaign.entity';
import { ReferralCommission } from '../entities/referral-commission.entity';

import { AsaasService } from './asaas.service';
import { SystemSetting } from '../entities/system-setting.entity';

@Injectable()
export class SubscriptionsService {
    private readonly logger = new Logger('SubscriptionsService');

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
        @InjectRepository(ReferralCommission)
        private referralCommissionRepository: Repository<ReferralCommission>,
        private asaasService: AsaasService,
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

        const currentMonthYear = new Date().toISOString().slice(0, 7);
        const usage = await this.userUsageRepository.findOne({
            where: { userId, monthYear: currentMonthYear }
        });

        // Use recorded usage if exists, otherwise fallback to 0
        const smsSent = usage?.smsSent ?? 0;
        const emailsSent = usage?.emailsSent ?? 0;
        const whatsappSent = usage?.whatsappSent ?? 0;
        const totalCampaigns = usage?.campaignsCreated ?? 0;

        return {
            smsSent: Number(smsSent),
            emailsSent: Number(emailsSent),
            whatsappSent: Number(whatsappSent),
            campaignsCreated: Number(totalCampaigns),
            smsLimit: subscription?.plan?.limits?.sms ?? null,
            emailsLimit: subscription?.plan?.limits?.emails ?? null,
            whatsappLimit: subscription?.plan?.limits?.whatsapp ? -1 : 0, // -1 means unlimited if true
            campaignsLimit: subscription?.plan?.limits?.advancedCampaigns ?? null,
            currentPlan: subscription?.plan?.name || 'Free',
            price: subscription?.plan?.price || 0,
        };
    }

    async checkout(userId: number, data: any, remoteIp?: string): Promise<any> {
        const { planId, billingType, document, address, phone, creditCard, creditCardHolderInfo } = data;

        const user = await this.userRepository.findOne({ where: { id: userId } });
        if (!user) throw new NotFoundException('Usuário não encontrado');

        const plan = await this.planRepository.findOne({ where: { id: planId } });
        if (!plan) throw new NotFoundException('Plano não encontrado');

        // 1. Atualizar dados do cliente (address e document)
        if (document) user.document = document;
        if (address) user.address = address;
        if (phone) user.phone = phone;
        await this.userRepository.save(user);

        try {
            // 2. Garantir que o cliente exista no Asaas
            let asaasCustomerId = (user as any).asaasCustomerId;
            if (!asaasCustomerId) {
                const asaasCustomer = await this.asaasService.createCustomer({
                    name: `${user.firstName} ${user.lastName}`,
                    email: user.email,
                    phone: user.phone,
                    cpfCnpj: user.document,
                });
                asaasCustomerId = asaasCustomer.id;
                (user as any).asaasCustomerId = asaasCustomerId;
                await this.userRepository.save(user);
            }

            // 3. Criar a assinatura no Asaas
            const nextDueDate = new Date();
            nextDueDate.setDate(nextDueDate.getDate() + 1);

            const asaasRequestData = {
                customer: asaasCustomerId,
                billingType: (billingType || 'BOLETO') as any,
                nextDueDate: nextDueDate.toISOString().split('T')[0],
                value: Number(plan.price),
                cycle: (plan.interval === 'yearly' ? 'YEARLY' : 'MONTHLY') as any,
                description: `Assinatura Plano ${plan.name}`,
            };

            this.logger.log(`Asaas Subscription Request: ${JSON.stringify(asaasRequestData, null, 2)}`);

            const asaasSub = await this.asaasService.createSubscription(asaasRequestData);

            this.logger.log(`Asaas Subscription Response: ${JSON.stringify(asaasSub, null, 2)}`);

            // Se for cartão de crédito, atualiza os dados do cartão para processar o pagamento
            if (billingType === 'CREDIT_CARD' && creditCard) {
                this.logger.log(`Updating Credit Card for subscription ${asaasSub.id}`);
                await this.asaasService.updateSubscriptionCreditCard(asaasSub.id, {
                    creditCard,
                    creditCardHolderInfo,
                    remoteIp
                });
            }

            // 4. Cancelar as assinaturas antigas ativas
            await this.subscriptionRepository.update(
                { userId, status: 'active' },
                { status: 'canceled' }
            );

            // 5. Criar a nova assinatura local (pendente até webhook confirmar)
            const newSubscription = this.subscriptionRepository.create({
                userId,
                planId,
                status: 'pending',
                asaasSubscriptionId: asaasSub.id,
                currentPeriodStart: new Date(),
                currentPeriodEnd: new Date(new Date().setMonth(new Date().getMonth() + (plan.interval === 'yearly' ? 12 : 1))),
            });
            const savedSubscription = await this.subscriptionRepository.save(newSubscription);

            return {
                success: true,
                message: 'Assinatura criada no Asaas com sucesso',
                subscription: savedSubscription,
                asaas: {
                    id: asaasSub.id,
                    invoiceUrl: asaasSub.invoiceUrl,
                    invoiceCustomizationUrl: asaasSub.invoiceCustomizationUrl
                }
            };
        } catch (error: any) {
            this.logger.error(`Checkout error: ${error.message}`);
            throw new Error(`Falha no checkout Asaas: ${error.message}`);
        }
    }

    async handleAsaasWebhook(payload: any, token: string) {
        const secretSetting = await this.userRepository.manager.getRepository(SystemSetting).findOne({
            where: { key: 'ASAAS_WEBHOOK_TOKEN' }
        });

        if (secretSetting && secretSetting.value && token !== secretSetting.value) {
            this.logger.warn('Asaas Webhook: Invalid token received');
            throw new UnauthorizedException('Invalid Asaas access token');
        }

        const { event, payment, subscription: asaasSubscription } = payload;
        this.logger.log(`Asaas Webhook: ${event} for payment ${payment?.id} / sub ${asaasSubscription?.id}`);

        if (event === 'PAYMENT_RECEIVED' || event === 'PAYMENT_CONFIRMED' || (event === 'SUBSCRIPTION_CREATED' && asaasSubscription?.status === 'ACTIVE')) {
            const asaasSubscriptionId = payment?.subscription || asaasSubscription?.id;
            if (asaasSubscriptionId) {
                const subscription = await this.subscriptionRepository.findOne({
                    where: { asaasSubscriptionId },
                    relations: ['user', 'plan']
                });

                if (subscription) {
                    subscription.status = 'active';
                    subscription.currentPeriodStart = new Date();
                    await this.subscriptionRepository.save(subscription);

                    // Criar fatura paga localmente
                    const newInvoice = this.invoiceRepository.create({
                        subscriptionId: subscription.id,
                        userId: subscription.userId,
                        amount: payment?.value || asaasSubscription?.value || subscription.plan?.price || 0,
                        status: 'paid',
                    });
                    await this.invoiceRepository.save(newInvoice);

                    // Lógica de Comissão de Indicação
                    const user = subscription.user;
                    const plan = subscription.plan;
                    if (user.referredById && plan.price > 0) {
                        const referrer = await this.userRepository.findOne({ where: { id: user.referredById } });
                        if (referrer) {
                            const commissionPercentage = Number(referrer.referralPercentage) || 3.00;
                            const commissionAmount = (Number(plan.price) * commissionPercentage) / 100;

                            const referralCommission = this.referralCommissionRepository.create({
                                referrerId: referrer.id,
                                referredId: user.id,
                                subscriptionId: subscription.id,
                                amount: commissionAmount,
                                percentage: commissionPercentage,
                            });
                            await this.referralCommissionRepository.save(referralCommission);
                        }
                    }

                    this.logger.log(`Assinatura ${subscription.id} ativada via pagamento Asaas.`);
                }
            }
        } else if (event === 'PAYMENT_OVERDUE') {
            const asaasSubscriptionId = payment.subscription;
            if (asaasSubscriptionId) {
                const subscription = await this.subscriptionRepository.findOne({
                    where: { asaasSubscriptionId }
                });
                if (subscription && subscription.status !== 'canceled') {
                    subscription.status = 'past_due';
                    await this.subscriptionRepository.save(subscription);
                    this.logger.warn(`Assinatura ${subscription.id} marcada como em atraso.`);
                }
            }
        }

        return { success: true };
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
