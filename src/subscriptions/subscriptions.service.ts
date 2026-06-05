import { Injectable, NotFoundException, Logger, UnauthorizedException, BadRequestException } from '@nestjs/common';
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
import { TemplateRequest, TemplateRequestStatus } from '../entities/template-request.entity';

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
        @InjectRepository(TemplateRequest)
        private templateRequestRepository: Repository<TemplateRequest>,
        @InjectRepository(SystemSetting)
        private systemSettingRepository: Repository<SystemSetting>,
        private asaasService: AsaasService,
        private notificationsService: NotificationsService,
    ) { }

    async getPlans(): Promise<Plan[]> {
        return this.planRepository.find({ where: { active: true, visible: true } });
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

        // Use recorded usage from the current billing cycle
        const smsSent = user?.cycleSmsSent || 0;
        const emailsSent = user?.cycleEmailsSent || 0;
        const whatsappSent = user?.cycleWhatsappSent || 0;
        const totalCampaigns = user?.cycleCampaignsCreated || 0;

        const isSubscriptionValid = subscription && !(subscription as any).isExpired;

        let whatsappLimitValue = Number(user?.extraWhatsappBalance || 0);
        
        // Admins always have unlimited WhatsApp for testing/demo purposes
        if (user?.role === 'admin') {
            whatsappLimitValue = -1;
        } else if (isSubscriptionValid && subscription?.plan?.limits?.whatsapp) {
            // Se o plano diz que tem WhatsApp, mas não define limite, assume 0 (e conta só os extras)
            // em vez de assumir ilimitado (-1)
            const planLimit = subscription?.plan?.limits?.whatsappLimit;
            
            if (planLimit === -1) {
                whatsappLimitValue = -1; // Unlimited
            } else if (planLimit !== undefined) {
                whatsappLimitValue += Number(planLimit);
            }
        }

        return {
            smsSent: Number(smsSent),
            emailsSent: Number(emailsSent),
            whatsappSent: Number(whatsappSent),
            campaignsCreated: Number(totalCampaigns),
            smsLimit: (isSubscriptionValid ? (subscription?.plan?.limits?.sms ?? 0) : 0) + (user?.extraSmsBalance || 0),
            emailsLimit: (isSubscriptionValid ? (subscription?.plan?.limits?.emails ?? 0) : 0) + (user?.extraEmailsBalance || 0),
            whatsappLimit: whatsappLimitValue,
            extraEmailsBalance: user?.extraEmailsBalance || 0,
            extraSmsBalance: user?.extraSmsBalance || 0,
            extraWhatsappBalance: user?.extraWhatsappBalance || 0,
            campaignsLimit: isSubscriptionValid ? (subscription?.plan?.limits?.advancedCampaigns ?? null) : null,
            currentPlan: subscription?.plan?.name || 'Free',
            price: subscription?.plan?.price || 0,
        };
    }

    private async executeAsaasActionWithCustomerRetry(user: User, action: (customerId: string) => Promise<any>): Promise<any> {
        let asaasCustomerId = (user as any).asaasCustomerId;
        
        if (!asaasCustomerId) {
            if (!user.document) throw new BadRequestException('Você precisa preencher seu CPF/CNPJ no perfil para transações no Asaas.');
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

        try {
            return await action(asaasCustomerId);
        } catch (error: any) {
            if (error.message && (error.message.toLowerCase().includes('customer inválido') || error.message.toLowerCase().includes('invalid customer') || error.message.toLowerCase().includes('cliente não encontrado'))) {
                this.logger.warn(`Asaas customer ${asaasCustomerId} invalid for user ${user.id}. Recreating customer in current Asaas environment.`);
                if (!user.document) throw new BadRequestException('Você precisa preencher seu CPF/CNPJ no perfil para transações no Asaas.');
                
                const newCustomer = await this.asaasService.createCustomer({
                    name: `${user.firstName} ${user.lastName}`,
                    email: user.email,
                    phone: user.phone,
                    cpfCnpj: user.document,
                });
                asaasCustomerId = newCustomer.id;
                (user as any).asaasCustomerId = asaasCustomerId;
                await this.userRepository.save(user);

                return await action(asaasCustomerId);
            }
            throw error;
        }
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
            const now = new Date();
            // Ajuste para Horário de Brasília (UTC-3)
            const brDate = new Date(now.getTime() - (3 * 60 * 60 * 1000));
            const dateString = brDate.toISOString().split('T')[0];

            const asaasRequestData = {
                customer: '',
                billingType: (billingType || 'BOLETO') as any,
                nextDueDate: dateString,
                value: Number(plan.price),
                cycle: (plan.interval === 'yearly' ? 'YEARLY' : 'MONTHLY') as any,
                description: `Assinatura Plano ${plan.name}`,
            };

            const asaasSub = await this.executeAsaasActionWithCustomerRetry(user, async (customerId) => {
                asaasRequestData.customer = customerId;
                this.logger.log(`Asaas Subscription Request: ${JSON.stringify(asaasRequestData, null, 2)}`);
                return await this.asaasService.createSubscription(asaasRequestData);
            });

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
        
        // Fetch current prices from settings
        const settings = await this.systemSettingRepository.find();
        const settingsMap = settings.reduce((acc, s) => ({ ...acc, [s.key]: s.value }), {} as Record<string, string>);

        let totalValue = 0;

        if (type === 'email') {
            // Check for packages first
            let packagePrice: number | null = null;
            for (let i = 1; i <= 4; i++) {
                const pkgAmount = parseInt(settingsMap[`EMAIL_PKG${i}_AMOUNT`] || '0');
                if (pkgAmount === amount) {
                    packagePrice = parseFloat(settingsMap[`EMAIL_PKG${i}_PRICE`] || '0');
                    break;
                }
            }

            if (packagePrice !== null) {
                totalValue = packagePrice;
            } else {
                const unitPrice = parseFloat(settingsMap['UNIT_PRICE_EMAIL'] || '0.01');
                totalValue = (unitPrice / 1000) * amount;
            }
        } else if (type === 'sms') {
            // Check for packages first
            let packagePrice: number | null = null;
            for (let i = 1; i <= 4; i++) {
                const pkgAmount = parseInt(settingsMap[`SMS_PKG${i}_AMOUNT`] || '0');
                if (pkgAmount === amount) {
                    packagePrice = parseFloat(settingsMap[`SMS_PKG${i}_PRICE`] || '0');
                    break;
                }
            }

            if (packagePrice !== null) {
                totalValue = packagePrice;
            } else {
                const unitPrice = parseFloat(settingsMap['UNIT_PRICE_SMS'] || '0.10');
                totalValue = unitPrice * amount;
            }
        } else if (type === 'whatsapp') {
            // Check for packages first
            let packagePrice: number | null = null;
            for (let i = 1; i <= 4; i++) {
                const pkgAmount = parseInt(settingsMap[`WHATSAPP_PKG${i}_AMOUNT`] || '0');
                if (pkgAmount === amount) {
                    packagePrice = parseFloat(settingsMap[`WHATSAPP_PKG${i}_PRICE`] || '0');
                    break;
                }
            }

            if (packagePrice !== null) {
                totalValue = packagePrice;
            } else {
                const unitPrice = parseFloat(settingsMap['UNIT_PRICE_WHATSAPP'] || '0.15');
                totalValue = unitPrice * amount;
            }
        } else {
            throw new Error('Invalid credit type');
        }

        const user = await this.userRepository.findOne({ where: { id: userId } });
        if (!user) throw new NotFoundException('Usuário não encontrado');

        try {
            const now = new Date();
            const brDate = new Date(now.getTime() - (3 * 60 * 60 * 1000));
            const dateString = brDate.toISOString().split('T')[0];

            // Define um externalReference pra conseguirmos identificar no webhook
            const externalRef = `EXTRA_CREDITS|${type}|${amount}|${userId}`;

            const asaasRequestData = {
                customer: '',
                billingType: (billingType || 'PIX') as any,
                value: totalValue,
                dueDate: dateString,
                description: `Pacote de ${amount} disparos de ${type.toUpperCase()}`,
                externalReference: externalRef,
                creditCard,
                creditCardHolderInfo,
                remoteIp,
                installmentCount: billingType === 'CREDIT_CARD' ? 1 : undefined
            };

            const asaasPayment = await this.executeAsaasActionWithCustomerRetry(user, async (customerId) => {
                asaasRequestData.customer = customerId;
                return await this.asaasService.createSinglePayment(asaasRequestData);
            });

            let qrCode = null;
            if (billingType === 'PIX') {
                try {
                    qrCode = await this.asaasService.getPixQrCode(asaasPayment.id);
                } catch (err: any) {
                    this.logger.warn(`Could not generate PIX QR Code for payment ${asaasPayment.id}: ${err.message}. Falling back to invoice URL.`);
                }
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

    async buyTemplateRequest(userId: number, data: any, remoteIp?: string): Promise<any> {
        const { content, billingType, creditCard, creditCardHolderInfo } = data;
        
        if (!content) throw new Error('Conteúdo do template é obrigatório.');

        const user = await this.userRepository.findOne({ where: { id: userId } });
        if (!user) throw new NotFoundException('Usuário não encontrado');

        const totalValue = 49.90; // Fixed value for template request

        try {
            // Create pending template request in local database
            const templateRequest = this.templateRequestRepository.create({
                userId,
                content,
                status: TemplateRequestStatus.PENDING_PAYMENT,
            });
            await this.templateRequestRepository.save(templateRequest);

            const now = new Date();
            const brDate = new Date(now.getTime() - (3 * 60 * 60 * 1000));
            const dateString = brDate.toISOString().split('T')[0];

            // Define um externalReference pra conseguirmos identificar no webhook
            const externalRef = `TEMPLATE_REQUEST|${templateRequest.id}|${userId}`;

            const asaasRequestData = {
                customer: '',
                billingType: (billingType || 'PIX') as any,
                value: totalValue,
                dueDate: dateString,
                description: `Solicitação de Criação de Template de WhatsApp`,
                externalReference: externalRef,
                creditCard,
                creditCardHolderInfo,
                remoteIp,
                installmentCount: billingType === 'CREDIT_CARD' ? 1 : undefined
            };

            const asaasPayment = await this.executeAsaasActionWithCustomerRetry(user, async (customerId) => {
                asaasRequestData.customer = customerId;
                return await this.asaasService.createSinglePayment(asaasRequestData);
            });

            // Update template request with payment ID
            templateRequest.paymentId = asaasPayment.id;
            await this.templateRequestRepository.save(templateRequest);

            let qrCode = null;
            if (billingType === 'PIX') {
                try {
                    qrCode = await this.asaasService.getPixQrCode(asaasPayment.id);
                } catch (err: any) {
                    this.logger.warn(`Could not generate PIX QR Code for template request payment ${asaasPayment.id}: ${err.message}. Falling back to invoice URL.`);
                }
            }

            return {
                success: true,
                message: 'Cobrança para o Template gerada com sucesso',
                paymentId: asaasPayment.id,
                qrCode,
                invoiceUrl: asaasPayment.invoiceUrl,
            };

        } catch (error: any) {
            this.logger.error(`Buy template request error: ${error.message}`);
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

            if (externalRef && externalRef.startsWith('TEMPLATE_REQUEST|')) {
                const [tag, reqIdStr, userIdStr] = externalRef.split('|');
                const reqId = parseInt(reqIdStr, 10);
                const userId = parseInt(userIdStr, 10);

                if (reqId && userId) {
                    const templateReq = await this.templateRequestRepository.findOne({ where: { id: reqId, userId } });
                    if (templateReq && templateReq.status === TemplateRequestStatus.PENDING_PAYMENT) {
                        templateReq.status = TemplateRequestStatus.REQUESTED;
                        await this.templateRequestRepository.save(templateReq);

                        const newInvoice = this.invoiceRepository.create({
                            userId,
                            amount: payment?.value || 0,
                            status: 'paid',
                            hostedInvoiceUrl: payment?.invoiceUrl,
                        });
                        await this.invoiceRepository.save(newInvoice);

                        this.logger.log(`Template Request ${reqId} do user ${userId} pago e marcado como solicitado.`);
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
                        user.cycleEmailsSent = 0;
                        user.cycleSmsSent = 0;
                        user.cycleWhatsappSent = 0;
                        user.cycleCampaignsCreated = 0;
                        await this.userRepository.save(user);

                        // Não resetamos mais a tabela `user_usages`. Ela continua acumulando dados do 
                        // calendário mensal para que os gráficos e faturamentos do CFO não quebrem.
                        // Os limites agora são avaliados pelos `user.cycle*`.
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
