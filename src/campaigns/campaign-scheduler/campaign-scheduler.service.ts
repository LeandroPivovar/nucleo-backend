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
import { Sale } from '../../entities/sale.entity';
import { ShopifyService } from '../../shopify/shopify.service';
import { NuvemshopService } from '../../nuvemshop/nuvemshop.service';
import { CampaignQueue } from '../../entities/campaign-queue.entity';
import { addMinutes, addHours, addDays } from 'date-fns';

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
        @InjectRepository(CampaignQueue)
        private campaignQueueRepository: Repository<CampaignQueue>,
        @InjectRepository(Sale)
        private saleRepository: Repository<Sale>,
        @InjectRepository(Contact)
        private contactRepository: Repository<Contact>,
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

    @Cron(CronExpression.EVERY_MINUTE)
    async processDelayedWorkflows() {
        this.logger.debug('Checking for delayed workflows to resume...');

        const now = new Date();
        const pendingQueue = await this.campaignQueueRepository.find({
            where: {
                status: 'pending',
                resumeAt: LessThanOrEqual(now),
            },
            relations: ['campaign', 'contact']
        });

        if (pendingQueue.length === 0) return;

        this.logger.log(`Found ${pendingQueue.length} delayed workflows to resume.`);

        for (const item of pendingQueue) {
            try {
                item.status = 'processing';
                await this.campaignQueueRepository.save(item);

                // Resume from the node FOLLOWING the delay
                await this.executeCampaignFlowFromNode(item.campaign, [item.contact], { id: item.delayNodeId, type: 'delay' }, item.eventContext);

                item.status = 'completed';
                await this.campaignQueueRepository.save(item);
            } catch (error: any) {
                this.logger.error(`Error resuming workflow ${item.id}: ${error.message}`);
                item.status = 'failed';
                await this.campaignQueueRepository.save(item);
            }
        }
    }

    async processCampaign(campaign: Campaign) {
        this.logger.log(`Processing campaign [ID: ${campaign.id}] - Channel: ${campaign.channel}`);

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
        }
    }

    async executeCampaignFlow(campaign: Campaign, targetContacts: Contact[]) {
        let successCount = 0;
        const BATCH_SIZE = 50;
        const context = await this.getExecutionContext(campaign);

        if (campaign.complexity === 'advanced') {
            const nodes = campaign.config?.workflow?.nodes || [];
            const edges = campaign.config?.workflow?.edges || [];

            const startNodeIds = nodes
                .filter(n => n.type === 'sendnow' || n.type === 'schedule' || !edges.some(e => e.target === n.id))
                .map(n => n.id);

            for (const contact of targetContacts) {
                for (const startNodeId of startNodeIds) {
                    const node = nodes.find(n => n.id === startNodeId);
                    if (node) {
                        await this.traverseAndExecute(campaign, contact, node, context);
                    }
                }
            }
            return;
        }

        // --- Simple Campaign Logic (Sequential) ---
        for (let i = 0; i < targetContacts.length; i += BATCH_SIZE) {
            const batch = targetContacts.slice(i, i + BATCH_SIZE);

            const batchPromises = batch.map(async (contact) => {
                let stats = { sentEmailCount: 0, sentSmsCount: 0, sentWhatsappCount: 0 };
                let activeCoupon: any = null;

                const nodes = campaign.config?.workflow?.nodes || [];
                for (const node of nodes) {
                    const result = await this.processSingleNode(campaign, contact, node, context, activeCoupon, stats);
                    if (result.activeCoupon) activeCoupon = result.activeCoupon;
                }
                return stats;
            });

            const results = await Promise.allSettled(batchPromises);
            let batchTotal = 0;
            results.forEach((result) => {
                if (result.status === 'fulfilled') {
                    batchTotal += result.value.sentEmailCount + result.value.sentSmsCount + result.value.sentWhatsappCount;
                }
            });

            campaign.sentCount = (campaign.sentCount || 0) + batchTotal;
            successCount += batchTotal;
            await this.campaignsRepository.save(campaign);
        }

        return successCount;
    }

    private async getExecutionContext(campaign: Campaign) {
        const currentMonthYear = new Date().toISOString().slice(0, 7);
        let usage = await this.userUsageRepository.findOne({ where: { userId: campaign.userId, monthYear: currentMonthYear } });
        if (!usage) {
            usage = this.userUsageRepository.create({ userId: campaign.userId, monthYear: currentMonthYear });
            await this.userUsageRepository.save(usage);
        }

        const subscription = await this.subscriptionRepository.findOne({ where: { userId: campaign.userId, status: 'active' }, relations: ['plan'] });
        const user = await this.userRepository.findOne({ where: { id: campaign.userId } });

        let shopifyConnection = null;
        try { shopifyConnection = await this.shopifyService.getActiveConnection(campaign.userId); } catch (e) { }

        let nuvemshopConnection = null;
        try { nuvemshopConnection = await this.nuvemshopService.getActiveConnection(campaign.userId); } catch (e) { }

        return {
            usage,
            subscription,
            user,
            shopifyConnection,
            nuvemshopConnection,
            planEmailsLimit: subscription?.plan?.limits?.emails || 0,
            planSmsLimit: subscription?.plan?.limits?.sms || 0,
            backendUrl: this.configService.get('BACKEND_URL', 'http://localhost:3000')
        };
    }

    async executeCampaignFlowFromNode(campaign: Campaign, targetContacts: Contact[], startNode: any, eventContext?: any) {
        const context = await this.getExecutionContext(campaign);
        for (const contact of targetContacts) {
            await this.traverseAndExecute(campaign, contact, startNode, context, eventContext);
        }
    }

    private async traverseAndExecute(campaign: Campaign, contact: Contact, startNode: any, context: any, eventContext?: any, activeCoupon?: any, depth = 0) {
        if (depth > 50) return;

        const nodes = campaign.config?.workflow?.nodes || [];
        const edges = campaign.config?.workflow?.edges || [];

        let currentNode = startNode;
        let stats = { sentEmailCount: 0, sentSmsCount: 0, sentWhatsappCount: 0 };
        let currentActiveCoupon = activeCoupon;

        // If starting from a delay node (resume), move to the NEXT node immediately
        if (currentNode.type === 'delay') {
            const nextEdge = edges.find(e => e.source === currentNode.id);
            if (!nextEdge) return;
            currentNode = nodes.find(n => n.id === nextEdge.target);
            if (!currentNode) return;
        }

        while (currentNode) {
            if (currentNode.type === 'delay') {
                const amount = parseInt(currentNode.data?.delayAmount || currentNode.data?.amount || '0');
                const unit = currentNode.data?.delayUnit || currentNode.data?.unit || 'minutes';
                let resumeAt = new Date();

                if (unit === 'minutes') resumeAt = addMinutes(resumeAt, amount);
                else if (unit === 'hours') resumeAt = addHours(resumeAt, amount);
                else if (unit === 'days') resumeAt = addDays(resumeAt, amount);

                await this.campaignQueueRepository.save({
                    userId: campaign.userId,
                    campaign,
                    contact,
                    delayNodeId: currentNode.id,
                    resumeAt,
                    eventContext,
                    status: 'pending'
                });
                this.logger.log(`Paused workflow for contact ${contact.id} at node ${currentNode.id}. Resume: ${resumeAt}`);
                return;
            }

            const result = await this.processSingleNode(campaign, contact, currentNode, context, currentActiveCoupon, stats);
            if (result.activeCoupon) currentActiveCoupon = result.activeCoupon;

            let nextNodeId: string | undefined;
            if (currentNode.type === 'condition') {
                const conditionResult = await this.evaluateCondition(currentNode, contact, eventContext);
                nextNodeId = edges.find((e: any) => e.source === currentNode.id && e.sourceHandle === (conditionResult ? 'true' : 'false'))?.target;
            } else {
                nextNodeId = edges.find((e: any) => e.source === currentNode.id)?.target;
            }

            if (!nextNodeId) break;
            currentNode = nodes.find(n => n.id === nextNodeId);
            depth++;
            if (depth > 50) break;
        }

        if (stats.sentEmailCount + stats.sentSmsCount + stats.sentWhatsappCount > 0) {
            campaign.sentCount = (campaign.sentCount || 0) + stats.sentEmailCount + stats.sentSmsCount + stats.sentWhatsappCount;
            await this.campaignsRepository.save(campaign);
        }
    }

    private async processSingleNode(campaign: Campaign, contact: Contact, node: any, context: any, activeCoupon: any, stats: any) {
        const { usage, user, shopifyConnection, nuvemshopConnection, planEmailsLimit, planSmsLimit, backendUrl } = context;
        let newActiveCoupon = activeCoupon;

        const currentEmailsSent = (Number(usage.emailsSent) || 0) + stats.sentEmailCount;
        const currentSmsSent = (Number(usage.smsSent) || 0) + stats.sentSmsCount;

        if (node.type === 'coupon' || node.type === 'giftback') {
            newActiveCoupon = { ...node.data, _type: node.type };
            if (node.type === 'giftback') {
                const val = node.data?.giftValue || node.data?.giftbackValue || '0';
                const days = parseInt(node.data?.expirationDays || '30');
                const endsAt = new Date();
                endsAt.setDate(endsAt.getDate() + days);

                if (shopifyConnection) {
                    try {
                        const gc = await this.shopifyService.createGiftCard(campaign.userId, shopifyConnection.shop, { initialValue: val, note: 'GIFTBACK', endsAt: endsAt.toISOString() });
                        newActiveCoupon._generatedCode = gc.code;
                    } catch (e) { }
                } else if (nuvemshopConnection) {
                    try {
                        const code = `GIFT_${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
                        await this.nuvemshopService.createCoupon(campaign.userId, nuvemshopConnection.storeId, { code, type: 'absolute', value: val, start_date: new Date().toISOString(), end_date: endsAt.toISOString(), max_uses: 1 });
                        newActiveCoupon._generatedCode = code;
                    } catch (e) { }
                }
            }
            return { activeCoupon: newActiveCoupon };
        }

        if (node.type === 'email' && contact.email) {
            if (currentEmailsSent < (planEmailsLimit + (user?.extraEmailsBalance || 0))) {
                let content = node.data?.content || '';
                if (newActiveCoupon) {
                    const valStr = newActiveCoupon.discountType === 'percentage' ? `${newActiveCoupon.discountValue}%` : `R$ ${newActiveCoupon.discountValue || newActiveCoupon.giftValue || newActiveCoupon.giftbackValue}`;
                    content = content.replace(/{{cupom_nome}}/g, newActiveCoupon._generatedCode || newActiveCoupon.couponName || 'CUPOM')
                        .replace(/{{cupom_valor}}/g, valStr)
                        .replace(/{{cupom_validade}}/g, newActiveCoupon.expirationDays || '30');
                }
                content = content.replace(/{{link_rastreio}}/g, `${backendUrl}/api/campaigns/track/${campaign.id}`);
                await this.emailService.sendEmail({ to: contact.email, subject: node.data?.subject || 'Nova Campanha', html: content, text: content.replace(/<[^>]*>?/gm, '') });
                stats.sentEmailCount++;
            }
        } else if (node.type === 'sms' && contact.phone) {
            if (currentSmsSent < (planSmsLimit + (user?.extraSmsBalance || 0))) {
                let content = node.data?.content || 'Olá!';
                if (newActiveCoupon) {
                    const valStr = newActiveCoupon.discountType === 'percentage' ? `${newActiveCoupon.discountValue}%` : `R$ ${newActiveCoupon.discountValue || newActiveCoupon.giftValue || newActiveCoupon.giftbackValue}`;
                    content = content.replace(/{{cupom_nome}}/g, newActiveCoupon._generatedCode || newActiveCoupon.couponName || 'CUPOM')
                        .replace(/{{cupom_valor}}/g, valStr)
                        .replace(/{{cupom_validade}}/g, newActiveCoupon.expirationDays || '30');
                }
                const success = await this.zenviaService.sendSms(contact.name || 'Contato', contact.phone, content);
                if (success) stats.sentSmsCount++;
            }
        } else if (node.type === 'whatsapp' && contact.phone) {
            let content = node.data?.content || 'Olá!';
            if (newActiveCoupon) {
                const valStr = newActiveCoupon.discountType === 'percentage' ? `${newActiveCoupon.discountValue}%` : `R$ ${newActiveCoupon.discountValue || newActiveCoupon.giftValue || newActiveCoupon.giftbackValue}`;
                content = content.replace(/{{cupom_nome}}/g, newActiveCoupon._generatedCode || newActiveCoupon.couponName || 'CUPOM')
                    .replace(/{{cupom_valor}}/g, valStr)
                    .replace(/{{cupom_validade}}/g, newActiveCoupon.expirationDays || '30');
            }
            const success = await this.zenviaService.sendWhatsapp(contact.name || 'Contato', contact.phone, content);
            if (success) stats.sentWhatsappCount++;
        }

        return { activeCoupon: newActiveCoupon };
    }

    private async evaluateCondition(node: any, contact: Contact, eventContext: any): Promise<boolean> {
        const condType = node.data?.conditionType;
        if (condType === 'order_placed' || condType === 'product_purchased' || condType === 'order_delivered') {
            const query = this.saleRepository.createQueryBuilder('sale').where('sale.contactId = :contactId', { contactId: contact.id });
            if (condType === 'product_purchased' && node.data?.productId) {
                query.andWhere('sale.productId = :productId', { productId: node.data.productId });
            }
            const recentSale = await query.orderBy('sale.createdAt', 'DESC').getOne();
            return !!recentSale;
        }

        if (!eventContext) return false;
        if ((condType === 'order_value' || condType === 'min_value') && eventContext.value) {
            const val = parseFloat(eventContext.value);
            const target = parseFloat(node.data?.value || '0');
            const op = node.data?.operator;
            if (op === 'greater') return val > target;
            if (op === 'less') return val < target;
            if (op === 'greater_equal') return val >= target;
            if (op === 'less_equal') return val <= target;
            return val === target;
        }
        if (condType === 'product_purchased' && node.data?.productId && eventContext.products) {
            return eventContext.products.some((p: any) => p.id?.toString() === node.data.productId.toString());
        }
        return condType === eventContext.eventType;
    }
}
