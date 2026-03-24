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
import { ShopifyConnection } from '../../entities/shopify-connection.entity';
import { NuvemshopConnection } from '../../entities/nuvemshop-connection.entity';
import { CampaignClick } from '../../entities/campaign-click.entity';
import { CampaignCoupon } from '../../entities/campaign-coupon.entity';
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
        @InjectRepository(CampaignClick)
        private campaignClicksRepository: Repository<CampaignClick>,
        @InjectRepository(CampaignCoupon)
        private campaignCouponRepository: Repository<CampaignCoupon>,
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
            this.logger.log(`[RESUME] Processing queue item ${item.id}: Campaign ${item.campaign?.id}, Contact ${item.contact?.id}, Node ${item.delayNodeId}`);
            try {
                item.status = 'processing';
                await this.campaignQueueRepository.save(item);

                this.logger.log(`[RESUME] Executing flow from node ${item.delayNodeId} for contact ${item.contact?.id}`);
                await this.executeCampaignFlowFromNode(item.campaign, [item.contact], { id: item.delayNodeId, type: 'delay' }, item.eventContext, true);

                item.status = 'completed';
                await this.campaignQueueRepository.save(item);
                this.logger.log(`Workflow resume completed for queue item ${item.id}`);
            } catch (error: any) {
                this.logger.error(`Error resuming workflow ${item.id} (Campaign: ${item.campaign?.id}, Contact: ${item.contact?.id}): ${error.message}`, error.stack);
                item.status = 'failed';
                await this.campaignQueueRepository.save(item);
            }
        }
    }

    async processCampaign(campaign: Campaign) {
        this.logger.log(`Iniciando processamento da campanha [ID: ${campaign.id}] - Canal: ${campaign.channel}`);

        campaign.status = 'ativa';
        await this.campaignsRepository.save(campaign);

        try {
            const groups = campaign.config?.groups || [];
            const segmentations = campaign.config?.segmentations || [];

            this.logger.log(`Buscando contatos para a campanha [ID: ${campaign.id}]. Segmentos: ${segmentations.length}, Grupos: ${groups.length}`);

            let targetContacts: Contact[] = [];

            if (segmentations.length > 0) {
                targetContacts = await this.contactsService.getContactsBySegments(campaign.userId, segmentations);
                this.logger.log(`Encontrados ${targetContacts.length} contatos via segmentação.`);
            }

            if (groups.length > 0) {
                const allContacts = await this.contactsService.findAll(campaign.userId);
                const groupContacts = allContacts.filter(contact =>
                    contact.group && groups.includes(contact.group.name)
                );

                this.logger.log(`Encontrados ${groupContacts.length} contatos via grupos.`);

                const existingIds = new Set(targetContacts.map(c => c.id));
                let groupAddedCount = 0;
                for (const contact of groupContacts) {
                    if (!existingIds.has(contact.id)) {
                        targetContacts.push(contact);
                        groupAddedCount++;
                    }
                }
                this.logger.log(`Adicionados ${groupAddedCount} novos contatos únicos de grupos. Total: ${targetContacts.length}`);
            }

            this.logger.log(`Resumo de contatos para a campanha [ID: ${campaign.id}]: ${targetContacts.length} contatos únicos identificados.`);

            if (targetContacts.length > 0) {
                this.logger.log(`Iniciando executeCampaignFlow para a campanha [ID: ${campaign.id}]`);
                await this.executeCampaignFlow(campaign, targetContacts);
            } else {
                this.logger.warn(`Campanha [ID: ${campaign.id}] não possui contatos para envio.`);
            }

            this.logger.log(`Processamento da campanha [ID: ${campaign.id}] finalizado.`);

        } catch (error: any) {
            this.logger.error(`Erro ao processar campanha [ID: ${campaign.id}]: ${error.message}`, error.stack);
        }
    }

    async executeCampaignFlow(campaign: Campaign, targetContacts: Contact[]) {
        this.logger.log(`Executando workflow da campanha [ID: ${campaign.id}, Complexidade: ${campaign.complexity}] para ${targetContacts.length} contatos.`);
        let successCount = 0;
        const BATCH_SIZE = 50;
        const context = await this.getExecutionContext(campaign);

        // Update recipientsCount for both simple and advanced campaigns
        campaign.recipientsCount = (campaign.recipientsCount || 0) + targetContacts.length;
        await this.campaignsRepository.save(campaign);

        if (campaign.complexity === 'advanced') {
            const nodes = campaign.config?.workflow?.nodes || [];
            const edges = campaign.config?.workflow?.edges || [];

            const startNodeIds = nodes
                .filter(n => n.type === 'sendnow' || n.type === 'schedule' || !edges.some(e => e.target === n.id))
                .map(n => n.id);

            this.logger.log(`Campanha avançada identificada. Nós de início: ${startNodeIds.join(', ')}`);

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
        // If simple nodes are empty, synthesize them from campaign config
        let simpleNodes = campaign.config?.workflow?.nodes || [];
        if (simpleNodes.length === 0) {
            this.logger.log(`Campanha simples sem nós definidos. Sintetizando nós a partir da configuração básica.`);
            if (campaign.config?.campaignConfig?.enableCoupon) {
                simpleNodes.push({ type: 'coupon', data: campaign.config.campaignConfig.coupon });
            }
            if (campaign.config?.campaignConfig?.enableGiftback) {
                simpleNodes.push({ type: 'giftback', data: campaign.config.campaignConfig.giftback });
            }
            // Adiciona o nó principal da mensagem
            simpleNodes.push({
                type: campaign.channel,
                data: {
                    ...campaign.config.email,
                    destinationUrl: campaign.config.tracking?.destinationUrl
                }
            });
        }

        this.logger.log(`Iniciando processamento em lote (Batch Size: ${BATCH_SIZE}) para campanha simples [ID: ${campaign.id}]`);
        for (let i = 0; i < targetContacts.length; i += BATCH_SIZE) {
            const batch = targetContacts.slice(i, i + BATCH_SIZE);
            this.logger.log(`Processando lote ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} contatos)`);

            const batchPromises = batch.map(async (contact) => {
                let stats = { sentEmailCount: 0, sentSmsCount: 0, sentWhatsappCount: 0 };
                let activeCoupon: any = null;

                for (const node of simpleNodes) {
                    const result = await this.processSingleNode(campaign, contact, node, context, activeCoupon, stats);
                    if (result.activeCoupon) activeCoupon = result.activeCoupon;
                }
                return stats;
            });

            const results = await Promise.allSettled(batchPromises);
            let batchTotal = 0;
            results.forEach((result, idx) => {
                if (result.status === 'fulfilled') {
                    batchTotal += result.value.sentEmailCount + result.value.sentSmsCount + result.value.sentWhatsappCount;
                } else {
                    this.logger.error(`Erro ao processar contato ${batch[idx].id} no lote: ${result.reason}`);
                }
            });

            campaign.sentCount = (campaign.sentCount || 0) + batchTotal;
            successCount += batchTotal;
            await this.campaignsRepository.save(campaign);
            this.logger.log(`Lote finalizado. Mensagens enviadas no lote: ${batchTotal}. Total acumulado: ${successCount}`);
        }

        this.logger.log(`Workflow da campanha simples [ID: ${campaign.id}] concluído. Total de sucessos: ${successCount}`);
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

        let shopifyConnection: ShopifyConnection | null = null;
        try { shopifyConnection = await this.shopifyService.getActiveConnection(campaign.userId); } catch (e) { }

        let nuvemshopConnection: NuvemshopConnection | null = null;
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

    async executeCampaignFlowFromNode(campaign: Campaign, targetContacts: Contact[], startNode: any, eventContext?: any, isResume = false) {
        // Increment recipientsCount only if NOT a resume
        if (!isResume) {
            campaign.recipientsCount = (campaign.recipientsCount || 0) + targetContacts.length;
            await this.campaignsRepository.save(campaign);
        }

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
            if (!nextEdge) {
                this.logger.warn(`No outgoing edge found for delay node ${currentNode.id} during resume for contact ${contact.id}`);
                return;
            }
            currentNode = nodes.find(n => n.id === nextEdge.target);
            if (!currentNode) {
                this.logger.warn(`Next node ${nextEdge.target} not found for contact ${contact.id}`);
                return;
            }
            this.logger.log(`Resuming traversal for contact ${contact.id} at node ${currentNode.id} (${currentNode.type})`);
        }

        while (currentNode) {
            if (currentNode.type === 'delay') {
                // Save current stats before pausing
                if (stats.sentEmailCount + stats.sentSmsCount + stats.sentWhatsappCount > 0) {
                    campaign.sentCount = (campaign.sentCount || 0) + stats.sentEmailCount + stats.sentSmsCount + stats.sentWhatsappCount;
                    await this.campaignsRepository.save(campaign);
                    stats.sentEmailCount = 0; stats.sentSmsCount = 0; stats.sentWhatsappCount = 0;
                }

                // Try various property names used by different frontend versions or node types
                const amount = parseInt(currentNode.data?.delay || currentNode.data?.delayAmount || currentNode.data?.amount || currentNode.data?.value || '0');
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
                const conditionResult = await this.evaluateCondition(currentNode, contact, campaign, eventContext);
                const matchingEdge = edges.find((e: any) => e.source === currentNode.id && e.sourceHandle === (conditionResult ? 'true' : 'false'));
                nextNodeId = matchingEdge?.target;
                this.logger.debug(`[FLOW] Condition ${currentNode.id} result: ${conditionResult}. Next node: ${nextNodeId || 'NONE'}`);
            } else {
                nextNodeId = edges.find((e: any) => e.source === currentNode.id)?.target;
                this.logger.debug(`[FLOW] Node ${currentNode.id} (${currentNode.type}) next node: ${nextNodeId || 'NONE'}`);
            }

            if (!nextNodeId) {
                this.logger.log(`[FLOW] Flow ended at node ${currentNode.id} for contact ${contact.id} (No outgoing edge or matching condition branch)`);
                break;
            }
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
            this.logger.log(`[NODE EXECUTING] ${node.type.toUpperCase()} | Campaign ID: ${campaign.id} | Contact ID: ${contact.id}`);
            newActiveCoupon = { ...node.data, _type: node.type };
            if (node.type === 'giftback') {
                const val = node.data?.giftValue || node.data?.giftbackValue || '0';
                const days = parseInt(node.data?.expirationDays || '30');
                const endsAt = new Date();
                endsAt.setDate(endsAt.getDate() + days);

                if (shopifyConnection) {
                    try {
                        this.logger.log(`[GIFTCARD] Gerando via Shopify para contato ${contact.id}`);
                        const gc = await this.shopifyService.createGiftCard(campaign.userId, shopifyConnection.shop, { initialValue: val, note: 'GIFTBACK', endsAt: endsAt.toISOString() });
                        newActiveCoupon._generatedCode = gc.code;
                        this.logger.log(`[GIFTCARD] Código gerado: ${gc.code}`);
                    } catch (e) {
                        this.logger.error(`[GIFTCARD] Erro ao gerar via Shopify: ${e.message}`);
                    }
                } else if (nuvemshopConnection) {
                    try {
                        this.logger.log(`[COUPON] Gerando via Nuvemshop para contato ${contact.id}`);
                        const code = `GIFT_${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
                        await this.nuvemshopService.createCoupon(campaign.userId, nuvemshopConnection.storeId, { code, type: 'absolute', value: val, start_date: new Date().toISOString(), end_date: endsAt.toISOString(), max_uses: 1 });
                        newActiveCoupon._generatedCode = code;
                        this.logger.log(`[COUPON] Código gerado: ${code}`);
                    } catch (e) {
                        this.logger.error(`[COUPON] Erro ao gerar via Nuvemshop: ${e.message}`);
                    }
                }
            }

            // Persistir o cupom gerado ou definido no banco de dados para segmentação
            if (newActiveCoupon && (newActiveCoupon._generatedCode || newActiveCoupon.couponName)) {
                try {
                    const days = parseInt(newActiveCoupon.expirationDays || '30');
                    const endsAt = new Date();
                    endsAt.setDate(endsAt.getDate() + days);

                    await this.campaignCouponRepository.save({
                        userId: campaign.userId,
                        campaignId: campaign.id,
                        contactId: contact.id,
                        code: newActiveCoupon._generatedCode || newActiveCoupon.couponName,
                        platform: shopifyConnection ? 'shopify' : (nuvemshopConnection ? 'nuvemshop' : 'internal'),
                        value: parseFloat(newActiveCoupon.discountValue || newActiveCoupon.giftValue || newActiveCoupon.giftbackValue || '0'),
                        type: newActiveCoupon.discountType || (node.type === 'giftback' ? 'absolute' : 'percentage'),
                        startsAt: new Date(),
                        endsAt: endsAt
                    });
                    this.logger.log(`[COUPON SAVE] Cupom salvo para contato ${contact.id}: ${newActiveCoupon._generatedCode || newActiveCoupon.couponName}`);
                } catch (e) {
                    this.logger.error(`[COUPON SAVE] Erro ao salvar cupom no banco: ${e.message}`);
                }
            }

            return { activeCoupon: newActiveCoupon };
        }

        if (node.type === 'email' && contact.email) {
            this.logger.log(`[NODE EXECUTING] EMAIL | Campaign ID: ${campaign.id} | Contact ID: ${contact.id} | Email: ${contact.email}`);
            if (currentEmailsSent < (planEmailsLimit + (user?.extraEmailsBalance || 0))) {
                let content = node.data?.content || '';
                if (newActiveCoupon) {
                    const val = newActiveCoupon.discountValue || newActiveCoupon.giftValue || newActiveCoupon.giftbackValue || '0';
                    const valStr = newActiveCoupon.discountType === 'percentage' ? `${val}%` : `R$ ${val}`;
                    const code = newActiveCoupon._generatedCode || newActiveCoupon.couponName || 'CUPOM';
                    const validity = newActiveCoupon.expirationDays || '30';

                    // Replaces variables if present
                    const hasVariables = content.includes('{{cupom_nome}}') || content.includes('{{cupom_valor}}');
                    content = content.replace(/{{cupom_nome}}/g, code)
                        .replace(/{{cupom_valor}}/g, valStr)
                        .replace(/{{cupom_validade}}/g, validity);

                    // Auto-append if no variables used (Simple campaign standard mode)
                    if (!hasVariables && campaign.complexity === 'simple') {
                        content += `<br/><br/><b>Seu cupom:</b> ${code}<br/><b>Desconto:</b> ${valStr}<br/><b>Validade:</b> ${validity} dias`;
                    }
                }
                content = content.replace(/{{link_rastreio}}/g, `${backendUrl}/api/campaigns/track/${campaign.id}`);
                try {
                    await this.emailService.sendEmail({ to: contact.email, subject: node.data?.subject || 'Nova Campanha', html: content, text: content.replace(/<[^>]*>?/gm, '') });
                    stats.sentEmailCount++;
                    this.logger.log(`[CAMPAIGN EMAIL EXECUTED] Sucesso | Campaign ID: ${campaign.id} | Contact ID: ${contact.id}`);
                } catch (error) {
                    this.logger.error(`[CAMPAIGN EMAIL EXECUTED] Falha | Campaign ID: ${campaign.id} | Contact ID: ${contact.id} | Erro: ${error.message}`);
                }
            } else {
                this.logger.warn(`[CAMPAIGN EMAIL EXECUTED] Limite atingido | User ID: ${campaign.userId} | Contact ID: ${contact.id}`);
            }
        } else if (node.type === 'sms' && contact.phone) {
            this.logger.log(`[NODE EXECUTING] SMS | Campaign ID: ${campaign.id} | Contact ID: ${contact.id} | Phone: ${contact.phone}`);
            if (currentSmsSent < (planSmsLimit + (user?.extraSmsBalance || 0))) {
                let content = node.data?.content || 'Olá!';
                if (newActiveCoupon) {
                    const val = newActiveCoupon.discountValue || newActiveCoupon.giftValue || newActiveCoupon.giftbackValue || '0';
                    const valStr = newActiveCoupon.discountType === 'percentage' ? `${val}%` : `R$ ${val}`;
                    const code = newActiveCoupon._generatedCode || newActiveCoupon.couponName || 'CUPOM';
                    const validity = newActiveCoupon.expirationDays || '30';

                    const hasVariables = content.includes('{{cupom_nome}}') || content.includes('{{cupom_valor}}');
                    content = content.replace(/{{cupom_nome}}/g, code)
                        .replace(/{{cupom_valor}}/g, valStr)
                        .replace(/{{cupom_validade}}/g, validity);

                    if (!hasVariables && campaign.complexity === 'simple') {
                        content += ` Seu cupom: ${code} (${valStr})`;
                    }
                }
                content = content.replace(/{{link_rastreio}}/g, `${backendUrl}/api/campaigns/track/${campaign.id}?contactId=${contact.id}`);
                try {
                    const success = await this.zenviaService.sendSms(contact.name || 'Contato', contact.phone, content);
                    if (success) {
                        stats.sentSmsCount++;
                        this.logger.log(`[CAMPAIGN SMS EXECUTED] Sucesso | Campaign ID: ${campaign.id} | Contact ID: ${contact.id}`);
                    } else {
                        this.logger.error(`[CAMPAIGN SMS EXECUTED] Rejeitado pelo provedor | Campaign ID: ${campaign.id} | Contact ID: ${contact.id}`);
                    }
                } catch (error) {
                    this.logger.error(`[CAMPAIGN SMS EXECUTED] Falha | Campaign ID: ${campaign.id} | Contact ID: ${contact.id} | Erro: ${error.message}`);
                }
            } else {
                this.logger.warn(`[CAMPAIGN SMS EXECUTED] Limite atingido | User ID: ${campaign.userId} | Contact ID: ${contact.id}`);
            }
        } else if (node.type === 'whatsapp' && contact.phone) {
            this.logger.log(`[NODE EXECUTING] WHATSAPP | Campaign ID: ${campaign.id} | Contact ID: ${contact.id} | Phone: ${contact.phone}`);
            let content = node.data?.content || 'Olá!';
            if (newActiveCoupon) {
                const val = newActiveCoupon.discountValue || newActiveCoupon.giftValue || newActiveCoupon.giftbackValue || '0';
                const valStr = newActiveCoupon.discountType === 'percentage' ? `${val}%` : `R$ ${val}`;
                const code = newActiveCoupon._generatedCode || newActiveCoupon.couponName || 'CUPOM';
                const validity = newActiveCoupon.expirationDays || '30';

                const hasVariables = content.includes('{{cupom_nome}}') || content.includes('{{cupom_valor}}');
                content = content.replace(/{{cupom_nome}}/g, code)
                    .replace(/{{cupom_valor}}/g, valStr)
                    .replace(/{{cupom_validade}}/g, validity);

                if (!hasVariables && campaign.complexity === 'simple') {
                    content += `\n\n*Seu cupom:* ${code}\n*Desconto:* ${valStr}`;
                }
            }
            content = content.replace(/{{link_rastreio}}/g, `${backendUrl}/api/campaigns/track/${campaign.id}?contactId=${contact.id}`);
            try {
                const success = await this.zenviaService.sendWhatsapp(contact.name || 'Contato', contact.phone, content);
                if (success) {
                    stats.sentWhatsappCount++;
                    this.logger.log(`[CAMPAIGN WHATSAPP EXECUTED] Sucesso | Campaign ID: ${campaign.id} | Contact ID: ${contact.id}`);
                } else {
                    this.logger.error(`[CAMPAIGN WHATSAPP EXECUTED] Rejeitado pelo provedor | Campaign ID: ${campaign.id} | Contact ID: ${contact.id}`);
                }
            } catch (error) {
                this.logger.error(`[CAMPAIGN WHATSAPP EXECUTED] Falha | Campaign ID: ${campaign.id} | Contact ID: ${contact.id} | Erro: ${error.message}`);
            }
        }


        return { activeCoupon: newActiveCoupon };
    }

    private async evaluateCondition(node: any, contact: Contact, campaign: Campaign, eventContext: any): Promise<boolean> {
        const condType = node.data?.conditionType || node.data?.type;
        const campaignId = campaign.id;
        let result = false;

        if (condType === 'order_placed' || condType === 'product_purchased' || condType === 'order_delivered') {
            const query = this.saleRepository.createQueryBuilder('sale')
                .where('sale.contactId = :contactId', { contactId: contact.id });

            // Atribuir à campanha se:
            // 1. A venda está explicitamente ligada à campanha
            // 2. A venda foi feita após o início da campanha
            query.andWhere('(sale.campaignId = :campaignId OR sale.createdAt >= :campaignDate)', {
                campaignId,
                campaignDate: campaign.createdAt
            });

            if (condType === 'product_purchased' && node.data?.productId) {
                query.andWhere('sale.productId = :productId', { productId: node.data.productId });
            }

            if (condType === 'order_delivered') {
                query.andWhere('sale.status = :status', { status: 'delivered' });
            }

            const recentSale = await query.orderBy('sale.createdAt', 'DESC').getOne();
            result = !!recentSale;
        } else if (condType === 'clicked_link') {
            const click = await this.campaignClicksRepository.findOne({
                where: { campaignId, contactId: contact.id }
            });
            result = !!click;
        } else if (eventContext) {
            if ((condType === 'order_value' || condType === 'min_value') && eventContext.value) {
                const val = parseFloat(eventContext.value);
                const target = parseFloat(node.data?.value || '0');
                const op = node.data?.operator;
                if (op === 'greater') result = val > target;
                else if (op === 'less') result = val < target;
                else if (op === 'greater_equal') result = val >= target;
                else if (op === 'less_equal') result = val <= target;
                else result = val === target;
            } else if (condType === 'product_purchased' && node.data?.productId && eventContext.products) {
                result = eventContext.products.some((p: any) => p.id?.toString() === node.data.productId.toString());
            } else {
                result = condType === eventContext.eventType;
            }
        }

        this.logger.debug(`Condition evaluated: ${condType} for contact ${contact.id} -> Result: ${result}`);
        return result;
    }
}
