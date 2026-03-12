import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { Campaign } from '../../entities/campaign.entity';
import { ZenviaService } from '../../zenvia/zenvia.service';
import { ContactsService } from '../../contacts/contacts.service';
import { EmailService } from '../../email/email.service';
import { UserUsage } from '../../entities/user-usage.entity';
import { User } from '../../entities/user.entity';
import { Subscription } from '../../entities/subscription.entity';
import { Contact } from '../../entities/contact.entity';
import { ShopifyService } from '../../shopify/shopify.service';

@Injectable()
export class CampaignSchedulerService {
    private readonly logger = new Logger(CampaignSchedulerService.name);

    constructor(
        @InjectRepository(Campaign)
        private campaignsRepository: Repository<Campaign>,
        @InjectRepository(UserUsage)
        private userUsageRepository: Repository<UserUsage>,
        @InjectRepository(User)
        private userRepository: Repository<User>,
        @InjectRepository(Subscription)
        private subscriptionRepository: Repository<Subscription>,
        private zenviaService: ZenviaService,
        private contactsService: ContactsService,
        private emailService: EmailService,
        private shopifyService: ShopifyService
    ) { }

    @Cron(CronExpression.EVERY_MINUTE)
    async handleScheduledCampaigns() {
        this.logger.debug('Checking for scheduled campaigns...');

        const now = new Date();
        const pendingCampaigns = await this.campaignsRepository.find({
            where: {
                status: 'agendada',
                scheduledAt: LessThanOrEqual(now),
            },
        });

        if (pendingCampaigns.length === 0) {
            return;
        }

        this.logger.log(`Found ${pendingCampaigns.length} campaigns to dispatch.`);

        for (const campaign of pendingCampaigns) {
            await this.processCampaign(campaign);
        }
    }

    async processCampaign(campaign: Campaign) {
        this.logger.log(`Processing campaign [ID: ${campaign.id}] - Channel: ${campaign.channel}`);

        // Update status to 'ativa' while processing
        campaign.status = 'ativa';
        await this.campaignsRepository.save(campaign);

        try {
            const groups = campaign.config?.groups || [];
            const segmentations = campaign.config?.segmentations || [];

            let targetContacts: Contact[] = [];

            if (segmentations.length > 0) {
                targetContacts = await this.contactsService.getContactsBySegments(campaign.userId, segmentations);
            }

            if (groups.length > 0) {
                const allContacts = await this.contactsService.findAll(campaign.userId);
                const groupContacts = allContacts.filter(contact =>
                    contact.group && groups.includes(contact.group.name)
                );

                // Merge and remove duplicates
                const existingIds = new Set(targetContacts.map(c => c.id));
                for (const contact of groupContacts) {
                    if (!existingIds.has(contact.id)) {
                        targetContacts.push(contact);
                    }
                }
            }

            this.logger.log(`Campaign [${campaign.id}] has ${targetContacts.length} target contacts.`);

            let successCount = 0;
            const BATCH_SIZE = 50;

            // Pré-carrega Usage e Assinatura para atualizar incrementalmente
            const currentMonthYear = new Date().toISOString().slice(0, 7);
            let usage = await this.userUsageRepository.findOne({
                where: { userId: campaign.userId, monthYear: currentMonthYear }
            });
            if (!usage) {
                usage = this.userUsageRepository.create({
                    userId: campaign.userId,
                    monthYear: currentMonthYear,
                });
                await this.userUsageRepository.save(usage);
            }

            const subscription = await this.subscriptionRepository.findOne({
                where: { userId: campaign.userId, status: 'active' },
                relations: ['plan'],
            });
            const planEmailsLimit = subscription?.plan?.limits?.emails || 0;
            const planSmsLimit = subscription?.plan?.limits?.sms || 0;
            const user = await this.userRepository.findOne({ where: { id: campaign.userId } });

            // Processar em Lotes
            for (let i = 0; i < targetContacts.length; i += BATCH_SIZE) {
                const batch = targetContacts.slice(i, i + BATCH_SIZE);
                let batchSuccessCount = 0;

                const batchPromises = batch.map(async (contact) => {
                    let sentEmailCount = 0;
                    let sentSmsCount = 0;
                    let sentWhatsappCount = 0;

                    if (campaign.complexity === 'advanced') {
                        const nodes = campaign.config?.workflow?.nodes || [];
                        let activeCoupon: any = null;
                        let shopifyBenefit: any = null;

                        for (const node of nodes) {
                            if (node.type === 'coupon' || node.type === 'giftback') {
                                activeCoupon = node.data;

                                // Shopify Integration for advanced campaigns
                                const shopifyStore = campaign.config?.shopifyStore;
                                if (shopifyStore && activeCoupon) {
                                    try {
                                        if (node.type === 'giftback') {
                                            const shopifyCustomer = await this.shopifyService.findCustomerByEmail(campaign.userId, shopifyStore, contact.email);
                                            const giftCardData = {
                                                initial_value: activeCoupon.giftValue || activeCoupon.discountValue,
                                                note: `Giftback da campanha: ${campaign.name}`,
                                                customer_id: shopifyCustomer?.id
                                            };
                                            shopifyBenefit = await this.shopifyService.createGiftCard(campaign.userId, shopifyStore, giftCardData);
                                        } else {
                                            // Para cupons, poderíamos criar uma Price Rule uma vez e reutilizar o código.
                                            // Por simplicidade nesta fase, vamos assumir que o benefício já existe ou criar um padrão.
                                            // Idealmente o UI permitiria selecionar ou definir a regra.
                                        }
                                    } catch (e) {
                                        this.logger.error(`Falha na integração Shopify: ${e.message}`);
                                    }
                                }
                                continue;
                            }

                            if (node.type === 'email' && contact.email) {
                                const subject = node.data?.subject || 'Nova Campanha';
                                let content = node.data?.content || '';

                                // Variable substitution
                                if (activeCoupon) {
                                    const value = activeCoupon.discountType === 'percentage'
                                        ? `${activeCoupon.discountValue}%`
                                        : (activeCoupon.discountValue ? `R$ ${activeCoupon.discountValue}` : `R$ ${activeCoupon.giftbackValue}`);

                                    const couponCode = shopifyBenefit?.code || activeCoupon.couponName || 'CUPOM';

                                    content = content
                                        .replace(/{{cupom_nome}}/g, couponCode)
                                        .replace(/{{cupom_valor}}/g, value)
                                        .replace(/{{cupom_validade}}/g, activeCoupon.expirationDays || '30');
                                }

                                try {
                                    await this.emailService.sendEmail({
                                        to: contact.email,
                                        subject: subject,
                                        html: content,
                                        text: content.replace(/<[^>]*>?/gm, '')
                                    });
                                    sentEmailCount++;
                                } catch (e) {
                                    this.logger.error(`Failed to send email to ${contact.email}`, e);
                                }
                            } else if (node.type === 'sms' && contact.phone) {
                                let content = node.data?.content || 'Olá! Temos uma novidade para você.';

                                // Variable substitution
                                if (activeCoupon) {
                                    const value = activeCoupon.discountType === 'percentage'
                                        ? `${activeCoupon.discountValue}%`
                                        : (activeCoupon.discountValue ? `R$ ${activeCoupon.discountValue}` : `R$ ${activeCoupon.giftbackValue}`);

                                    const couponCode = shopifyBenefit?.code || activeCoupon.couponName || 'CUPOM';

                                    content = content
                                        .replace(/{{cupom_nome}}/g, couponCode)
                                        .replace(/{{cupom_valor}}/g, value)
                                        .replace(/{{cupom_validade}}/g, activeCoupon.expirationDays || '30');
                                }

                                const success = await this.zenviaService.sendSms(contact.name || 'Contato CRM', contact.phone, content);
                                if (success) sentSmsCount++;
                            } else if (node.type === 'whatsapp' && contact.phone) {
                                let content = node.data?.content || 'Olá! Temos uma novidade para você.';

                                // Variable substitution
                                if (activeCoupon) {
                                    const value = activeCoupon.discountType === 'percentage'
                                        ? `${activeCoupon.discountValue}%`
                                        : (activeCoupon.discountValue ? `R$ ${activeCoupon.discountValue}` : `R$ ${activeCoupon.giftbackValue}`);

                                    const couponCode = shopifyBenefit?.code || activeCoupon.couponName || 'CUPOM';

                                    content = content
                                        .replace(/{{cupom_nome}}/g, couponCode)
                                        .replace(/{{cupom_valor}}/g, value)
                                        .replace(/{{cupom_validade}}/g, activeCoupon.expirationDays || '30');
                                }

                                const success = await this.zenviaService.sendWhatsapp(contact.name || 'Contato CRM', contact.phone, content);
                                if (success) sentWhatsappCount++;
                            }
                        }
                    } else {
                        // Logic for 'simple' campaigns
                        let sent = false;
                        let messageContent = campaign.config?.email?.content || 'Olá! Temos uma novidade para você.';

                        // Variable substitution for simple campaign
                        const campaignConfig = campaign.config?.campaignConfig;
                        let shopifyBenefit: any = null;

                        // Shopify Integration for Simple Campaigns
                        const shopifyStore = campaign.config?.shopifyStore;
                        if (shopifyStore && (campaignConfig?.enableCoupon || campaignConfig?.enableGiftback)) {
                            try {
                                if (campaignConfig.enableGiftback) {
                                    const giftback = campaignConfig.giftback;
                                    const shopifyCustomer = await this.shopifyService.findCustomerByEmail(campaign.userId, shopifyStore, contact.email);
                                    const giftCardData = {
                                        initial_value: giftback.giftValue,
                                        note: `Giftback da campanha: ${campaign.name}`,
                                        customer_id: shopifyCustomer?.id
                                    };
                                    shopifyBenefit = await this.shopifyService.createGiftCard(campaign.userId, shopifyStore, giftCardData);
                                } else if (campaignConfig.enableCoupon) {
                                    // Para campanhas simples de cupom, poderíamos implementar a Price Rule aqui também.
                                    // No momento vamos focar em gift cards que são mais personalizados.
                                }
                            } catch (e) {
                                this.logger.error(`Falha na integração Shopify (Simple): ${e.message}`);
                            }
                        }

                        if (campaignConfig?.enableCoupon) {
                            const coupon = campaignConfig.coupon;
                            const value = coupon.discountType === 'percentage'
                                ? `${coupon.discountValue}%`
                                : `R$ ${coupon.discountValue}`;

                            const validity = coupon.validityDate
                                ? Math.ceil((new Date(coupon.validityDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))
                                : 30;

                            // Auto-append if placeholders are missing and it's not email
                            if (!messageContent.includes('{{cupom_nome}}') && campaign.channel !== 'email') {
                                messageContent += `\n\nCupom: {{cupom_nome}}\nValor: {{cupom_valor}}\nValidade: {{cupom_validade}} dias`;
                            }

                            const couponCode = shopifyBenefit?.code || coupon.couponName || 'CUPOM';

                            messageContent = messageContent
                                .replace(/{{cupom_nome}}/g, couponCode)
                                .replace(/{{cupom_valor}}/g, value)
                                .replace(/{{cupom_validade}}/g, validity.toString());
                        } else if (campaignConfig?.enableGiftback) {
                            const giftback = campaignConfig.giftback;
                            const value = `R$ ${giftback.giftValue}`;

                            const validity = giftback.validityDate
                                ? Math.ceil((new Date(giftback.validityDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))
                                : 30;

                            // Auto-append if placeholders are missing and it's not email
                            if (!messageContent.includes('{{cupom_nome}}') && campaign.channel !== 'email') {
                                messageContent += `\n\nGiftback: {{cupom_nome}}\nValor: {{cupom_valor}}\nValidade: {{cupom_validade}} dias`;
                            }

                            const couponCode = shopifyBenefit?.code || giftback.couponName || 'CASHBACK';

                            messageContent = messageContent
                                .replace(/{{cupom_nome}}/g, couponCode)
                                .replace(/{{cupom_valor}}/g, value)
                                .replace(/{{cupom_validade}}/g, validity.toString());
                        }

                        if (campaign.channel === 'whatsapp' || campaign.channel === 'sms') {
                            if (!contact.phone) {
                                this.logger.warn(`Contact ${contact.id} has no phone number. Skipping.`);
                                return { sentEmailCount, sentSmsCount, sentWhatsappCount };
                            }

                            if (campaign.channel === 'whatsapp') {
                                sent = await this.zenviaService.sendWhatsapp(contact.name || 'Contato CRM', contact.phone, messageContent);
                                if (sent) sentWhatsappCount++;
                            } else if (campaign.channel === 'sms') {
                                sent = await this.zenviaService.sendSms(contact.name || 'Contato CRM', contact.phone, messageContent);
                                if (sent) sentSmsCount++;
                            }
                        } else if (campaign.channel === 'email') {
                            if (!contact.email) {
                                this.logger.warn(`Contact ${contact.id} has no email address. Skipping.`);
                                return { sentEmailCount, sentSmsCount, sentWhatsappCount };
                            }

                            const subject = campaign.config?.email?.subject || 'Nova Campanha';

                            try {
                                await this.emailService.sendEmail({
                                    to: contact.email,
                                    subject: subject,
                                    html: messageContent,
                                    text: messageContent.replace(/<[^>]*>?/gm, '')
                                });
                                sentEmailCount++;
                                sent = true;
                            } catch (e) {
                                this.logger.error(`Failed to send email to ${contact.email}`, e);
                            }
                        }
                    }

                    return { sentEmailCount, sentSmsCount, sentWhatsappCount };
                });

                // Espera o lote terminar (seja sucesso ou erro isolado)
                const results = await Promise.allSettled(batchPromises);

                let batchEmailSuccessCount = 0;
                let batchSmsSuccessCount = 0;
                let batchWhatsappSuccessCount = 0;

                results.forEach((result) => {
                    if (result.status === 'fulfilled') {
                        batchEmailSuccessCount += result.value.sentEmailCount;
                        batchSmsSuccessCount += result.value.sentSmsCount;
                        batchWhatsappSuccessCount += result.value.sentWhatsappCount;
                    }
                });

                const totalBatchSuccessCount = batchEmailSuccessCount + batchSmsSuccessCount + batchWhatsappSuccessCount;
                successCount += totalBatchSuccessCount;

                // Atualizar campanha incrementalmente
                campaign.sentCount = (campaign.sentCount || 0) + totalBatchSuccessCount;
                campaign.recipientsCount = targetContacts.length;
                await this.campaignsRepository.save(campaign);

                // Atualizar Usage incrementalmente
                let usageChanged = false;
                if (batchEmailSuccessCount > 0) {
                    const currentUsage = Number(usage.emailsSent) || 0;
                    const newUsage = currentUsage + batchEmailSuccessCount;
                    if (newUsage > planEmailsLimit && user && user.extraEmailsBalance > 0) {
                        const exceededAmount = newUsage - Math.max(currentUsage, planEmailsLimit);
                        user.extraEmailsBalance = Math.max(0, user.extraEmailsBalance - exceededAmount);
                        await this.userRepository.save(user);
                    }
                    usage.emailsSent = newUsage;
                    usageChanged = true;
                }

                if (batchSmsSuccessCount > 0) {
                    const currentUsage = Number(usage.smsSent) || 0;
                    const newUsage = currentUsage + batchSmsSuccessCount;
                    if (newUsage > planSmsLimit && user && user.extraSmsBalance > 0) {
                        const exceededAmount = newUsage - Math.max(currentUsage, planSmsLimit);
                        user.extraSmsBalance = Math.max(0, user.extraSmsBalance - exceededAmount);
                        await this.userRepository.save(user);
                    }
                    usage.smsSent = newUsage;
                    usageChanged = true;
                }

                if (batchWhatsappSuccessCount > 0) {
                    usage.whatsappSent = (Number(usage.whatsappSent) || 0) + batchWhatsappSuccessCount;
                    usageChanged = true;
                }

                if (usageChanged) {
                    await this.userUsageRepository.save(usage);
                }

                this.logger.log(`Lote ${Math.floor(i / BATCH_SIZE) + 1} de campanhas finalizado: ${totalBatchSuccessCount} enviados com sucesso.`);
            }

            if (campaign.complexity !== 'advanced') {
                campaign.status = 'finalizada'; // Mark as done when all batches are processed
                await this.campaignsRepository.save(campaign);
            }

            this.logger.log(`Campaign [${campaign.id}] finished overall. Successfully sent: ${successCount} total messages.`);

        } catch (error: any) {
            this.logger.error(`Error processing campaign [ID: ${campaign.id}]: ${error.message}`);
            // If failed brutally, leave it as 'ativa' or set to 'erro' (not in enum though)
        }
    }
}
