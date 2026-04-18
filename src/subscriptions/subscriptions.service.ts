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
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../entities/notification.entity';

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
        private notificationsService: NotificationsService,
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
        const user = await this.userRepository.findOne({ where: { id: userId } });

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
            smsLimit: (subscription?.plan?.limits?.sms ?? 0) + (user?.extraSmsBalance || 0),
            emailsLimit: (subscription?.plan?.limits?.emails ?? 0) + (user?.extraEmailsBalance || 0),
            whatsappLimit: (user?.extraWhatsappBalance || 0),
            extraEmailsBalance: user?.extraEmailsBalance || 0,
            extraSmsBalance: user?.extraSmsBalance || 0,
            extraWhatsappBalance: user?.extraWhatsappBalance || 0,
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
            const now = new Date();
            // Ajuste para Horário de Brasília (UTC-3)
            const brDate = new Date(now.getTime() - (3 * 60 * 60 * 1000));
            const dateString = brDate.toISOString().split('T')[0];

            const asaasRequestData = {
                customer: asaasCustomerId,
                billingType: (billingType || 'BOLETO') as any,
                nextDueDate: dateString,
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

            // Se for PIX, buscar o QR Code do primeiro pagamento
            let qrCode = null;
            if (billingType === 'PIX') {
                try {
                    const payments = await this.asaasService.getSubscriptionPayments(asaasSub.id);
                    if (payments.data && payments.data.length > 0) {
                        const firstPayment = payments.data[0];
                        qrCode = await this.asaasService.getPixQrCode(firstPayment.id);
                    }
                } catch (err) {
                    this.logger.error(`Error fetching PIX QR Code for subscription ${asaasSub.id}: ${err.message}`);
                }
            }

            return {
                success: true,
                message: 'Assinatura criada no Asaas com sucesso',
                subscription: savedSubscription,
                qrCode,
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

    async buyCredits(userId: number, data: any, remoteIp?: string): Promise<any> {
        const { type, amount, billingType, creditCard, creditCardHolderInfo } = data;
        let pricePerUnit = 0;
        if (type === 'email') pricePerUnit = 0.30;
        else if (type === 'sms') pricePerUnit = 0.40;
        else if (type === 'whatsapp') {
            pricePerUnit = 0.06;
        }
        else throw new Error('Invalid credit type');

        const totalValue = pricePerUnit * amount;

        const user = await this.userRepository.findOne({ where: { id: userId } });
        if (!user) throw new NotFoundException('Usuário não encontrado');

        try {
            // Garantir que o cliente exista no Asaas (caso tente comprar avulso sem assinar antes)
            let asaasCustomerId = (user as any).asaasCustomerId;
            if (!asaasCustomerId) {
                const asaasCustomer = await this.asaasService.createCustomer({
                    name: `${user.firstName} ${user.lastName}`,
                    email: user.email,
                    phone: user.phone,
                    cpfCnpj: user.document || '00000000000', // Asaas required se não tiver, mas idealmente o usuário já preencheu
                });
                asaasCustomerId = asaasCustomer.id;
                (user as any).asaasCustomerId = asaasCustomerId;
                await this.userRepository.save(user);
            }

            const now = new Date();
            const brDate = new Date(now.getTime() - (3 * 60 * 60 * 1000));
            const dateString = brDate.toISOString().split('T')[0];

            // Define um externalReference pra conseguirmos identificar no webhook
            const externalRef = `EXTRA_CREDITS|${type}|${amount}|${userId}`;

            const asaasRequestData = {
                customer: asaasCustomerId,
                billingType: (billingType || 'PIX') as any,
                value: totalValue,
                dueDate: dateString,
                description: `Pacote de ${amount} disparos de ${type.toUpperCase()}`,
                externalReference: externalRef,
                creditCard,
                creditCardHolderInfo,
                remoteIp
            };

            const asaasPayment = await this.asaasService.createSinglePayment(asaasRequestData);

            let qrCode = null;
            if (billingType === 'PIX') {
                qrCode = await this.asaasService.getPixQrCode(asaasPayment.id);
            }

            return {
                success: true,
                message: 'Cobrança gerada com sucesso',
                paymentId: asaasPayment.id,
                qrCode,
                invoiceUrl: asaasPayment.invoiceUrl,
            };

        } catch (error: any) {
            this.logger.error(`Buy credits error: ${error.message}`);
            throw new Error(`Falha na geração de cobrança Asaas: ${error.message}`);
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

        if (event === 'PAYMENT_RECEIVED' || event === 'PAYMENT_CONFIRMED') {
            const externalRef = payment?.externalReference;

            // Tratamento de pacotes extras avulsos
            if (externalRef && externalRef.startsWith('EXTRA_CREDITS|')) {
                const [tag, type, amountStr, userIdStr] = externalRef.split('|');
                const amount = parseInt(amountStr, 10);
                const userId = parseInt(userIdStr, 10);

                if (userId && amount) {
                    const user = await this.userRepository.findOne({ where: { id: userId } });
                    if (user) {
                        if (type === 'email') user.extraEmailsBalance = (user.extraEmailsBalance || 0) + amount;
                        else if (type === 'sms') user.extraSmsBalance = (user.extraSmsBalance || 0) + amount;
                        else if (type === 'whatsapp') user.extraWhatsappBalance = (user.extraWhatsappBalance || 0) + amount;
                        await this.userRepository.save(user);

                        // Criar fatura de pacote avulso
                        const newInvoice = this.invoiceRepository.create({
                            subscriptionId: undefined, // Sem assinatura vinculada
                            userId: user.id,
                            amount: payment?.value || 0,
                            status: 'paid',
                            hostedInvoiceUrl: payment?.invoiceUrl,
                        });
                        await this.invoiceRepository.save(newInvoice);

                        this.logger.log(`Pacote de ${amount} ${type} adicionado com sucesso ao usuário ${userId}.`);
                        return { success: true };
                    }
                }
            }

            // Tratamento de assinaturas normais
            const asaasSubscriptionId = payment?.subscription;
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
                        hostedInvoiceUrl: payment?.invoiceUrl,
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

                    // Vincular o plano ao usuário e zerar limites gerais
                    if (user) {
                        user.planId = subscription.planId;
                        user.subscriptionStatus = 'active';
                        user.emailsSentMonth = 0; // Reseta envios do mês na tabela principal
                        await this.userRepository.save(user);

                        // Resetar envios do mês na tabela detalhada (user_usages)
                        const brDate = new Date(new Date().getTime() - (3 * 60 * 60 * 1000));
                        const currentMonthYear = `${brDate.getFullYear()}-${String(brDate.getMonth() + 1).padStart(2, '0')}`;

                        let currentUsage = await this.userUsageRepository.findOne({
                            where: { userId: user.id, monthYear: currentMonthYear }
                        });

                        if (currentUsage) {
                            currentUsage.emailsSent = 0;
                            currentUsage.whatsappSent = 0;
                            // smsSent e campaignsCreated não são resetados se não fizer sentido, 
                            // mas envios de e-mail e whatsapp sim pois são os maiores custos diretos.
                            await this.userUsageRepository.save(currentUsage);
                        } else {
                            currentUsage = this.userUsageRepository.create({
                                userId: user.id,
                                monthYear: currentMonthYear,
                                emailsSent: 0,
                                whatsappSent: 0,
                                smsSent: 0,
                                campaignsCreated: 0
                            });
                            await this.userUsageRepository.save(currentUsage);
                        }
                    }

                    this.logger.log(`Assinatura ${subscription.id} ativada e plano ${subscription.planId} vinculado ao usuário ${user?.id} via pagamento Asaas.`);
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

    async checkAndNotifyUpcomingInvoice(userId: number) {
        try {
            // Verificar se o usuário deseja receber notificações de faturamento
            const isEnabled = await this.notificationsService.isPreferenceEnabled(userId, NotificationType.BILLING);
            if (!isEnabled) return;

            const subscription = await this.subscriptionRepository.findOne({
                where: { userId, status: 'active' },
                order: { createdAt: 'DESC' },
            });

            if (!subscription || !subscription.currentPeriodEnd) return;

            const now = new Date();
            const dueDate = new Date(subscription.currentPeriodEnd);
            const diffTime = dueDate.getTime() - now.getTime();
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            // Se o vencimento for em 5 dias ou menos (e ainda não venceu)
            if (diffDays <= 5 && diffDays > 0) {
                const dateString = dueDate.toLocaleDateString('pt-BR');
                const title = `💳 Fatura disponível - Vencimento ${dateString}`;

                // Verificar se já existe uma notificação para esta fatura/data para este usuário
                const alreadyNotified = await this.notificationsService.exists(
                    userId,
                    NotificationType.BILLING,
                    title
                );

                if (!alreadyNotified) {
                    await this.notificationsService.create({
                        userId,
                        title,
                        message: `Sua próxima fatura com vencimento em ${dateString} já está disponível.\n\nO boleto ou chave PIX deve aparecer em seu e-mail em instantes. Você também pode acessar os detalhes na aba Financeiro.`,
                        type: NotificationType.BILLING,
                    });
                    this.logger.log(`Billing notification created for user ${userId} (due in ${diffDays} days)`);
                }
            }
        } catch (error) {
            this.logger.error(`Error checking upcoming invoice for user ${userId}: ${error.message}`);
        }
    }
}
