import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Campaign } from '../../entities/campaign.entity';
import { ZenviaService } from '../../zenvia/zenvia.service';
import { ContactsService } from '../../contacts/contacts.service';
import { EmailService } from '../../email/email.service';
import { UserUsage } from '../../entities/user-usage.entity';
import { User } from '../../entities/user.entity';
import { Subscription } from '../../entities/subscription.entity';
import { Contact } from '../../entities/contact.entity';
import { ShopifyService } from '../../shopify/shopify.service';
import { NuvemshopService } from '../../nuvemshop/nuvemshop.service';

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
        private shopifyService: ShopifyService,
        private nuvemshopService: NuvemshopService,
        private configService: ConfigService
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

            if (targetContacts.length > 0) {
                await this.executeCampaignFlow(campaign, targetContacts);
            }

            this.logger.log(`Campaign [${campaign.id}] finished overall.`);

        } catch (error: any) {
            this.logger.error(`Error processing campaign [ID: ${campaign.id}]: ${error.message}`);
            // If failed brutally, leave it as 'ativa' or set to 'erro' (not in enum though)
        }
    }

    async executeCampaignFlow(campaign: Campaign, targetContacts: Contact[]) {
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

        // Fetch active Shopify Connection (if any)
        let shopifyConnection: any = null;
        try {
            shopifyConnection = await this.shopifyService.getActiveConnection(campaign.userId);
        } catch (e) {
            // Ignore se não encontrar
        }

        // Fetch active Nuvemshop Connection (if any)
        let nuvemshopConnection: any = null;
        try {
            nuvemshopConnection = await this.nuvemshopService.getActiveConnection(campaign.userId);
        } catch (e) {
            // Ignore se não encontrar
        }

        let generatedDiscountCode: string | null = null;

        // Tratamento prévio para "Coupon" em campanhas simples
        if (campaign.complexity === 'simple' && campaign.config?.campaignConfig?.enableCoupon) {
            const coupon = campaign.config.campaignConfig.coupon;
            const endsAtDate = new Date();
            endsAtDate.setDate(endsAtDate.getDate() + (coupon.validityDate ? Math.ceil((new Date(coupon.validityDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)) : 30));

            const apiCode = coupon.couponName || 'CUPOM_NUCLEO_CRM';

            if (shopifyConnection) {
                try {
                    await this.shopifyService.createDiscountCode(
                        campaign.userId,
                        shopifyConnection.shop,
                        {
                            title: apiCode,
                            code: apiCode,
                            value: coupon.discountValue,
                            valueType: coupon.discountType,
                            endsAt: endsAtDate.toISOString()
                        }
                    );
                    this.logger.log(`Created Shopify Discount Code: ${apiCode} for campaign ${campaign.id}`);
                    generatedDiscountCode = apiCode;
                } catch (error) {
                    this.logger.error(`Failed to create Shopify Discount Code for campaign ${campaign.id}`, error);
                }
            } else if (nuvemshopConnection) {
                try {
                    await this.nuvemshopService.createCoupon(
                        campaign.userId,
                        nuvemshopConnection.storeId,
                        {
                            code: apiCode,
                            type: coupon.discountType === 'percentage' ? 'percentage' : 'absolute',
                            value: coupon.discountValue,
                            start_date: new Date().toISOString(),
                            end_date: endsAtDate.toISOString(),
                        }
                    );
                    this.logger.log(`Created Nuvemshop Coupon: ${apiCode} for campaign ${campaign.id}`);
                    generatedDiscountCode = apiCode;
                } catch (error) {
                    this.logger.error(`Failed to create Nuvemshop Coupon for campaign ${campaign.id}`, error);
                }
            }
        }

        // Tratamento prévio para "Coupon" em fluxos avançados
        if (campaign.complexity === 'advanced') {
            const nodes = campaign.config?.workflow?.nodes || [];
            const couponNode = nodes.find((n: any) => n.type === 'coupon');
            if (couponNode && couponNode.data) {
                const couponData = couponNode.data;
                const endsAtDate = new Date();
                endsAtDate.setDate(endsAtDate.getDate() + parseInt(couponData.expirationDays || '30'));

                const apiCode = couponData.couponName || 'CUPOM_NUCLEO_CRM';

                if (shopifyConnection) {
                    try {
                        await this.shopifyService.createDiscountCode(
                            campaign.userId,
                            shopifyConnection.shop,
                            {
                                title: apiCode,
                                code: apiCode,
                                value: couponData.discountValue,
                                valueType: couponData.discountType,
                                endsAt: endsAtDate.toISOString()
                            }
                        );
                        this.logger.log(`Created Shopify Discount Code (Advanced): ${apiCode} for campaign ${campaign.id}`);
                        generatedDiscountCode = apiCode;
                    } catch (error) {
                        this.logger.error(`Failed to create Shopify Discount Code (Advanced) for campaign ${campaign.id}`, error);
                    }
                } else if (nuvemshopConnection) {
                    try {
                        await this.nuvemshopService.createCoupon(
                            campaign.userId,
                            nuvemshopConnection.storeId,
                            {
                                code: apiCode,
                                type: couponData.discountType === 'percentage' ? 'percentage' : 'absolute',
                                value: couponData.discountValue,
                                start_date: new Date().toISOString(),
                                end_date: endsAtDate.toISOString(),
                            }
                        );
                        this.logger.log(`Created Nuvemshop Coupon (Advanced): ${apiCode} for campaign ${campaign.id}`);
                        generatedDiscountCode = apiCode;
                    } catch (error) {
                        this.logger.error(`Failed to create Nuvemshop Coupon (Advanced) for campaign ${campaign.id}`, error);
                    }
                }
            }
        }

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

                    for (const node of nodes) {
                        // 0. Check Limits before any metered send
                        const currentEmailsSent = (Number(usage.emailsSent) || 0) + sentEmailCount;
                        const currentSmsSent = (Number(usage.smsSent) || 0) + sentSmsCount;

                        if (node.type === 'coupon' || node.type === 'giftback') {
                            activeCoupon = { ...node.data, _type: node.type };
                            // Gerar Gift Card individual caso suporte shopify
                            if (node.type === 'giftback' && shopifyConnection) {
                                const endsAtDate = new Date();
                                endsAtDate.setDate(endsAtDate.getDate() + parseInt(activeCoupon.expirationDays || '30'));
                                try {
                                    const initialVal = activeCoupon.giftbackValue || '0';
                                    const generatedGift = await this.shopifyService.createGiftCard(
                                        campaign.userId,
                                        shopifyConnection.shop,
                                        {
                                            initialValue: initialVal,
                                            note: activeCoupon.couponName || 'GIFTBACK',
                                            endsAt: endsAtDate.toISOString()
                                        }
                                    );
                                    activeCoupon._generatedCode = generatedGift.code;
                                    this.logger.log(`Generated GC (Shopify) for contact ${contact.email || contact.phone}`);
                                } catch (e) {
                                    this.logger.error(`Error generating GC (Shopify)`, e);
                                }
                            } else if (node.type === 'giftback' && nuvemshopConnection) {
                                // Nuvemshop Giftback via Coupon (Dynamic)
                                const endsAtDate = new Date();
                                endsAtDate.setDate(endsAtDate.getDate() + parseInt(activeCoupon.expirationDays || '30'));
                                try {
                                    const initialVal = activeCoupon.giftbackValue || '0';
                                    const randomSuffix = Math.random().toString(36).substring(2, 8).toUpperCase();
                                    const giftCode = `${activeCoupon.couponName || 'GIFT'}_${randomSuffix}`;
                                    await this.nuvemshopService.createCoupon(
                                        campaign.userId,
                                        nuvemshopConnection.storeId,
                                        {
                                            code: giftCode,
                                            type: 'absolute',
                                            value: initialVal,
                                            start_date: new Date().toISOString(),
                                            end_date: endsAtDate.toISOString(),
                                            max_uses: 1
                                        }
                                    );
                                    activeCoupon._generatedCode = giftCode;
                                    this.logger.log(`Generated GC (Nuvemshop) for contact ${contact.email || contact.phone}`);
                                } catch (e) {
                                    this.logger.error(`Error generating GC (Nuvemshop)`, e);
                                }
                            }
                            continue;
                        }

                        if (node.type === 'email' && contact.email) {
                            // Check Email Limit
                            const totalEmailBalance = planEmailsLimit + (user?.extraEmailsBalance || 0);
                            if (currentEmailsSent >= totalEmailBalance) {
                                this.logger.warn(`Email limit reached for user ${campaign.userId}. Skipping node ${node.id} for contact ${contact.email}`);
                                continue;
                            }

                            const subject = node.data?.subject || 'Nova Campanha';
                            let content = node.data?.content || '';

                            // Variable substitution
                            if (activeCoupon) {
                                const value = activeCoupon.discountType === 'percentage'
                                    ? `${activeCoupon.discountValue}%`
                                    : (activeCoupon.discountValue ? `R$ ${activeCoupon.discountValue}` : `R$ ${activeCoupon.giftbackValue}`);

                                content = content
                                    .replace(/{{cupom_nome}}/g, activeCoupon._generatedCode || generatedDiscountCode || activeCoupon.couponName || 'CUPOM')
                                    .replace(/{{cupom_valor}}/g, value)
                                    .replace(/{{cupom_validade}}/g, activeCoupon.expirationDays || '30');
                            }

                            // Link Rastreio Substitution
                            const trackingLink = `${this.configService.get('BACKEND_URL', 'http://localhost:3000')}/api/campaigns/track/${campaign.id}`;
                            content = content.replace(/{{link_rastreio}}/g, trackingLink);

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
                            // Check SMS Limit
                            const totalSmsBalance = planSmsLimit + (user?.extraSmsBalance || 0);
                            if (currentSmsSent >= totalSmsBalance) {
                                this.logger.warn(`SMS limit reached for user ${campaign.userId}. Skipping node ${node.id} for contact ${contact.phone}`);
                                continue;
                            }

                            let content = node.data?.content || 'Olá! Temos uma novidade para você.';

                            // Variable substitution
                            if (activeCoupon) {
                                const value = activeCoupon.discountType === 'percentage'
                                    ? `${activeCoupon.discountValue}%`
                                    : (activeCoupon.discountValue ? `R$ ${activeCoupon.discountValue}` : `R$ ${activeCoupon.giftbackValue}`);

                                content = content
                                    .replace(/{{cupom_nome}}/g, activeCoupon._generatedCode || generatedDiscountCode || activeCoupon.couponName || 'CUPOM')
                                    .replace(/{{cupom_valor}}/g, value)
                                    .replace(/{{cupom_validade}}/g, activeCoupon.expirationDays || '30');
                            }

                            // Link Rastreio Substitution
                            const trackingLink = `${this.configService.get('BACKEND_URL', 'http://localhost:3000')}/api/campaigns/track/${campaign.id}`;
                            content = content.replace(/{{link_rastreio}}/g, trackingLink);

                            const success = await this.zenviaService.sendSms(contact.name || 'Contato CRM', contact.phone, content);
                            if (success) sentSmsCount++;
                        } else if (node.type === 'whatsapp' && contact.phone) {
                            let content = node.data?.content || 'Olá! Temos uma novidade para você.';

                            // Variable substitution
                            if (activeCoupon) {
                                const value = activeCoupon.discountType === 'percentage'
                                    ? `${activeCoupon.discountValue}%`
                                    : (activeCoupon.discountValue ? `R$ ${activeCoupon.discountValue}` : `R$ ${activeCoupon.giftbackValue}`);

                                content = content
                                    .replace(/{{cupom_nome}}/g, activeCoupon._generatedCode || generatedDiscountCode || activeCoupon.couponName || 'CUPOM')
                                    .replace(/{{cupom_valor}}/g, value)
                                    .replace(/{{cupom_validade}}/g, activeCoupon.expirationDays || '30');
                            }

                            // Link Rastreio Substitution
                            const trackingLink = `${this.configService.get('BACKEND_URL', 'http://localhost:3000')}/api/campaigns/track/${campaign.id}`;
                            content = content.replace(/{{link_rastreio}}/g, trackingLink);

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

                        messageContent = messageContent
                            .replace(/{{cupom_nome}}/g, generatedDiscountCode || coupon.couponName || 'CUPOM')
                            .replace(/{{cupom_valor}}/g, value)
                            .replace(/{{cupom_validade}}/g, validity.toString());
                    } else if (campaignConfig?.enableGiftback) {
                        const giftback = campaignConfig.giftback;
                        const value = `R$ ${giftback.giftValue}`;

                        const validity = giftback.validityDate
                            ? Math.ceil((new Date(giftback.validityDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))
                            : 30;

                        let giftbackCode = giftback.couponName || 'CASHBACK';
                        if (shopifyConnection) {
                            const endsAtDate = new Date();
                            endsAtDate.setDate(endsAtDate.getDate() + validity);
                            try {
                                const generatedGift = await this.shopifyService.createGiftCard(
                                    campaign.userId,
                                    shopifyConnection.shop,
                                    {
                                        initialValue: giftback.giftValue,
                                        note: giftbackCode,
                                        endsAt: endsAtDate.toISOString()
                                    }
                                );
                                giftbackCode = generatedGift.code;
                            } catch (e) {
                                this.logger.error('Error generating simple giftback GC (Shopify)', e);
                            }
                        } else if (nuvemshopConnection) {
                            const endsAtDate = new Date();
                            endsAtDate.setDate(endsAtDate.getDate() + validity);
                            try {
                                const randomSuffix = Math.random().toString(36).substring(2, 8).toUpperCase();
                                const generatedCode = `${giftbackCode}_${randomSuffix}`;
                                await this.nuvemshopService.createCoupon(
                                    campaign.userId,
                                    nuvemshopConnection.storeId,
                                    {
                                        code: generatedCode,
                                        type: 'absolute',
                                        value: giftback.giftValue,
                                        start_date: new Date().toISOString(),
                                        end_date: endsAtDate.toISOString(),
                                        max_uses: 1
                                    }
                                );
                                giftbackCode = generatedCode;
                            } catch (e) {
                                this.logger.error('Error generating simple giftback GC (Nuvemshop)', e);
                            }
                        }

                        // Auto-append if placeholders are missing and it's not email
                        if (!messageContent.includes('{{cupom_nome}}') && campaign.channel !== 'email') {
                            messageContent += `\n\nGiftback: {{cupom_nome}}\nValor: {{cupom_valor}}\nValidade: {{cupom_validade}} dias`;
                        }

                        messageContent = messageContent
                            .replace(/{{cupom_nome}}/g, giftbackCode)
                            .replace(/{{cupom_valor}}/g, value)
                            .replace(/{{cupom_validade}}/g, validity.toString());
                    }

                    // Link Rastreio Substitution for Simple Campaign
                    const trackingLink = `${this.configService.get('BACKEND_URL', 'http://localhost:3000')}/api/campaigns/track/${campaign.id}`;
                    messageContent = messageContent.replace(/{{link_rastreio}}/g, trackingLink);

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
            // Incrementar recipientsCount caso targetContacts tenham sido adicionados manualmente no fluxo!
            // Wait: the manualContacts are already inside targetContacts, but processCampaign initially sets it to total. 
            // We just update the overall count, or just increment it instead of overwriting it?
            // Since we want to support incremental, we shouldn't overwrite it with `targetContacts.length`.
            // Because targetContacts represents ONLY the batch added now! No, targetContacts is the whole list... Wait, processCampaign has all targetContacts.
            campaign.recipientsCount = (campaign.recipientsCount || 0) + targetContacts.length;
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

            this.logger.log(`Lote ${Math.floor(i / BATCH_SIZE) + 1} finalizado: ${totalBatchSuccessCount} enviados com sucesso.`);
        }

        return successCount;
    }
}

