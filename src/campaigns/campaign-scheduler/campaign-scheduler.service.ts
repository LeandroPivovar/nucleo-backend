import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository, In, MoreThan } from 'typeorm';
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
import { LojaIntegradaService } from '../../loja-integrada/loja-integrada.service';
import { VtexService } from '../../vtex/vtex.service';
import { CampaignQueue } from '../../entities/campaign-queue.entity';
import { ShopifyConnection } from '../../entities/shopify-connection.entity';
import { NuvemshopConnection } from '../../entities/nuvemshop-connection.entity';
import { CampaignClick } from '../../entities/campaign-click.entity';
import { CampaignCoupon } from '../../entities/campaign-coupon.entity';
import { addMinutes, addHours, addDays, format } from 'date-fns';



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
        private lojaIntegradaService: LojaIntegradaService,
        private vtexService: VtexService,
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
            this.logger.log(`Sincronizando dados de e-commerce antes de processar a campanha [ID: ${campaign.id}]...`);
            const syncPromises: Promise<any>[] = [];

            try {
                const shopifyConn = await this.shopifyService.getActiveConnection(campaign.userId);
                if (shopifyConn) {
                    syncPromises.push(this.shopifyService.syncOrders(campaign.userId, shopifyConn.shop).catch(e => this.logger.warn(`[Pre-Sync] Shopify Orders: ${e.message}`)));
                    syncPromises.push(this.shopifyService.syncCheckouts(campaign.userId, shopifyConn.shop).catch(e => this.logger.warn(`[Pre-Sync] Shopify Checkouts: ${e.message}`)));
                }
            } catch (e) { }

            try {
                const nuvemshopConn = await this.nuvemshopService.getActiveConnection(campaign.userId);
                if (nuvemshopConn) {
                    syncPromises.push(this.nuvemshopService.syncOrders(campaign.userId, nuvemshopConn.storeId).catch(e => this.logger.warn(`[Pre-Sync] Nuvemshop Orders: ${e.message}`)));
                    syncPromises.push(this.nuvemshopService.syncCheckouts(campaign.userId, nuvemshopConn.storeId).catch(e => this.logger.warn(`[Pre-Sync] Nuvemshop Checkouts: ${e.message}`)));
                }
            } catch (e) { }

            try {
                const liConn = await this.lojaIntegradaService.getActiveConnection(campaign.userId);
                if (liConn) {
                    syncPromises.push(this.lojaIntegradaService.syncOrders(campaign.userId).catch(e => this.logger.warn(`[Pre-Sync] Loja Integrada Orders: ${e.message}`)));
                    if (this.lojaIntegradaService.syncCheckouts) {
                        syncPromises.push(this.lojaIntegradaService.syncCheckouts(campaign.userId).catch(e => this.logger.warn(`[Pre-Sync] Loja Integrada Checkouts: ${e.message}`)));
                    }
                }
            } catch (e) { }

            try {
                const vtexConn = await this.vtexService.getActiveConnection(campaign.userId);
                if (vtexConn) {
                    syncPromises.push(this.vtexService.syncOrders(campaign.userId, vtexConn.accountName).catch(e => this.logger.warn(`[Pre-Sync] VTEX Orders: ${e.message}`)));
                    if ('syncCheckouts' in this.vtexService) {
                        syncPromises.push((this.vtexService as any).syncCheckouts(campaign.userId, vtexConn.accountName).catch((e: any) => this.logger.warn(`[Pre-Sync] VTEX Checkouts: ${e.message}`)));
                    }
                }
            } catch (e) { }

            if (syncPromises.length > 0) {
                await Promise.allSettled(syncPromises);
                this.logger.log(`Sincronização de pré-campanha finalizada.`);
            }

            const groups = campaign.config?.groups || [];
            const segmentations = campaign.config?.segmentations || [];
            const specificContacts = campaign.config?.specificContacts || [];

            this.logger.log(`Buscando contatos para a campanha [ID: ${campaign.id}]. Segmentos: ${segmentations.length}, Grupos: ${groups.length}, Específicos: ${specificContacts.length}`);

            let targetContacts: Contact[] = [];

            // 1. Buscar por Segmentações e Grupos (Query Otimizada via ContactsService)
            if (segmentations.length > 0 || groups.length > 0) {
                const mappedGroups = groups.map((g: any) => Number(g)).filter((n: number) => !isNaN(n));
                targetContacts = await this.contactsService.getContactsBySegments(campaign.userId, segmentations, mappedGroups);
                this.logger.log(`Encontrados ${targetContacts.length} contatos via segmentação e/ou grupos.`);
            }

            // 2. Buscar Contatos Específicos
            if (specificContacts.length > 0) {
                const allContacts = await this.contactsService.findAll(campaign.userId);
                const specificContactsList = allContacts.filter(contact => specificContacts.includes(contact.id));
                const existingIds = new Set(targetContacts.map(c => c.id));

                let specificAddedCount = 0;
                for (const contact of specificContactsList) {
                    if (!existingIds.has(contact.id)) {
                        targetContacts.push(contact);
                        specificAddedCount++;
                    }
                }
                this.logger.log(`Adicionados ${specificAddedCount} novos contatos da seleção específica. Total: ${targetContacts.length}`);
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
                    const endsAt = newActiveCoupon.validityDate ? new Date(newActiveCoupon.validityDate) : new Date();
                    if (!newActiveCoupon.validityDate) {
                        const days = parseInt(newActiveCoupon.expirationDays || '30');
                        endsAt.setDate(endsAt.getDate() + days);
                    }

                    await this.campaignCouponRepository.save({
                        userId: campaign.userId,
                        campaignId: campaign.id,
                        contactId: contact.id,
                        name: newActiveCoupon.couponName || (node.type === 'giftback' ? 'Giftback' : 'Cupom'),
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

                    let validity = '';
                    if (newActiveCoupon.validityDate) {
                        try {
                            validity = format(new Date(newActiveCoupon.validityDate), 'dd/MM/yyyy');
                        } catch (e) {
                            validity = newActiveCoupon.expirationDays ? `${newActiveCoupon.expirationDays} dias` : '30 dias';
                        }
                    } else {
                        validity = newActiveCoupon.expirationDays ? `${newActiveCoupon.expirationDays} dias` : '30 dias';
                    }

                    // Replaces variables if present

                    const hasVariables = content.includes('{{cupom_nome}}') || content.includes('{{cupom_valor}}');
                    content = content.replace(/{{cupom_nome}}/g, code)
                        .replace(/{{cupom_valor}}/g, valStr)
                        .replace(/{{cupom_validade}}/g, validity);

                    // Auto-append if no variables used (Simple campaign standard mode)
                    if (!hasVariables && campaign.complexity === 'simple') {
                        content += `<br/><br/>CUPOM: ${code}<br/>DESCONTO: ${valStr}<br/>DATA DE VALIDADE: ${validity} dias`;
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

                    let validity = '';
                    if (newActiveCoupon.validityDate) {
                        try {
                            validity = format(new Date(newActiveCoupon.validityDate), 'dd/MM/yyyy');
                        } catch (e) {
                            validity = newActiveCoupon.expirationDays ? `${newActiveCoupon.expirationDays} dias` : '30 dias';
                        }
                    } else {
                        validity = newActiveCoupon.expirationDays ? `${newActiveCoupon.expirationDays} dias` : '30 dias';
                    }

                    const hasVariables = content.includes('{{cupom_nome}}') || content.includes('{{cupom_valor}}');

                    content = content.replace(/{{cupom_nome}}/g, code)
                        .replace(/{{cupom_valor}}/g, valStr)
                        .replace(/{{cupom_validade}}/g, validity);

                    if (!hasVariables && campaign.complexity === 'simple') {
                        content += `\n\nCUPOM: ${code}\nDESCONTO: ${valStr}\nDATA DE VALIDADE: ${validity} dias`;
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

                let validity = '';
                if (newActiveCoupon.validityDate) {
                    try {
                        validity = format(new Date(newActiveCoupon.validityDate), 'dd/MM/yyyy');
                    } catch (e) {
                        validity = newActiveCoupon.expirationDays ? `${newActiveCoupon.expirationDays} dias` : '30 dias';
                    }
                } else {
                    validity = newActiveCoupon.expirationDays ? `${newActiveCoupon.expirationDays} dias` : '30 dias';
                }

                const hasVariables = content.includes('{{cupom_nome}}') || content.includes('{{cupom_valor}}');

                content = content.replace(/{{cupom_nome}}/g, code)
                    .replace(/{{cupom_valor}}/g, valStr)
                    .replace(/{{cupom_validade}}/g, validity);

                if (!hasVariables && campaign.complexity === 'simple') {
                    content += `\n\nCUPOM: ${code}\nDESCONTO: ${valStr}\nDATA DE VALIDADE: ${validity} dias`;
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

        if (condType === 'order_placed' || condType === 'product_purchased' || condType === 'order_delivered' || condType === 'order_cancelled' || condType === 'order_awaiting_payment' || condType === 'payment_method') {
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

            if (condType === 'order_cancelled') {
                query.andWhere('sale.status = :status', { status: 'cancelled' });
            }

            if (condType === 'order_awaiting_payment') {
                query.andWhere('sale.status = :status', { status: 'pending' });
            }

            if (condType === 'payment_method' && node.data?.paymentMethod) {
                let pmMatch = node.data.paymentMethod;
                // Mapeamento dinâmico básico para cobrir diferentes retornos como 'wire_transfer' e 'credit_card'
                if (pmMatch === 'credit_card') pmMatch = 'credit';
                else if (pmMatch === 'debit_card') pmMatch = 'debit';
                else if (pmMatch === 'bank_transfer') pmMatch = 'transfer';
                
                query.andWhere('LOWER(sale.paymentMethod) LIKE LOWER(:paymentMethod)', { paymentMethod: `%${pmMatch}%` });
            }

            const recentSale = await query.orderBy('sale.createdAt', 'DESC').getOne();
            result = !!recentSale;
        } else if (condType === 'clicked_link') {
            const click = await this.campaignClicksRepository.findOne({
                where: { campaignId, contactId: contact.id }
            });
            result = !!click;
        } else if (condType === 'cart_abandoned') {
            const cart = await this.saleRepository.findOne({
                where: {
                    contactId: contact.id,
                    userId: campaign.userId,
                    status: In(['active_cart', 'abandoned_cart'])
                }
            });
            result = !!cart;
        } else if (condType === 'cart_recovered') {
            // Buscar se há uma venda concluída recente
            const completedSale = await this.saleRepository.createQueryBuilder('sale')
                .where('sale.contactId = :contactId', { contactId: contact.id })
                .andWhere('sale.status IN (:...statuses)', { statuses: ['completed', 'pago'] })
                .andWhere('sale.createdAt >= :campaignDate', { campaignDate: campaign.createdAt })
                .orderBy('sale.createdAt', 'DESC')
                .getOne();

            if (completedSale) {
                // Verificar se houve um carrinho abandonado antes dessa compra
                const previousCart = await this.saleRepository.createQueryBuilder('cart')
                    .where('cart.contactId = :contactId', { contactId: contact.id })
                    .andWhere('cart.status IN (:...cartStatuses)', { cartStatuses: ['active_cart', 'abandoned_cart'] })
                    .andWhere('cart.createdAt < :purchaseDate', { purchaseDate: completedSale.createdAt })
                    .getOne();
                result = !!previousCart;
            }
        } else if (condType === 'date_condition') {
            const now = new Date();
            let isValid = true;
            if (node.data?.dateFrom) {
                const dateFrom = new Date(node.data.dateFrom);
                if (now < dateFrom) isValid = false;
            }
            if (node.data?.dateTo) {
                const dateTo = new Date(node.data.dateTo);
                dateTo.setHours(23, 59, 59, 999);
                if (now > dateTo) isValid = false;
            }
            // Precisamos que pelo menos uma data seja configurada para avaliar
            result = isValid && (!!node.data?.dateFrom || !!node.data?.dateTo);
        } else if (condType === 'giftback_value') {
            const now = new Date();
            const coupons = await this.campaignCouponRepository.find({
                where: {
                    contactId: contact.id,
                    userId: campaign.userId,
                    type: 'absolute',
                    endsAt: MoreThan(now)
                }
            });
            
            const totalGiftback = coupons.reduce((sum, c) => sum + Number(c.value || 0), 0);
            const target = parseFloat(node.data?.value || '0');
            const op = node.data?.operator;

            if (op === 'greater') result = totalGiftback > target;
            else if (op === 'less') result = totalGiftback < target;
            else if (op === 'greater_equal') result = totalGiftback >= target;
            else if (op === 'less_equal') result = totalGiftback <= target;
            else if (op === 'between') {
                 const target2 = parseFloat(node.data?.value2 || '0');
                 result = totalGiftback >= target && totalGiftback <= target2;
            }
            else result = totalGiftback === target;
        } else if (condType === 'has_active_coupon') {
            const now = new Date();
            const coupon = await this.campaignCouponRepository.findOne({
                where: {
                    contactId: contact.id,
                    userId: campaign.userId,
                    endsAt: MoreThan(now)
                }
            });
            result = !!coupon;
        } else if (condType === 'in_group') {
            const targetGroupId = parseInt(node.data?.groupId);
            result = contact.groupId === targetGroupId;
        } else if (condType === 'total_sales_value') {
            const { sum } = await this.saleRepository.createQueryBuilder('sale')
                .select('SUM(sale.totalValue)', 'sum')
                .where('sale.contactId = :contactId', { contactId: contact.id })
                .andWhere('sale.status IN (:...statuses)', { statuses: ['completed', 'pago'] })
                .getRawOne();
            const ltv = parseFloat(sum || '0');
            const target = parseFloat(node.data?.value || '0');
            const op = node.data?.operator;
            if (op === 'greater') result = ltv > target;
            else if (op === 'less') result = ltv < target;
            else if (op === 'greater_equal') result = ltv >= target;
            else if (op === 'less_equal') result = ltv <= target;
            else if (op === 'between') {
                 const target2 = parseFloat(node.data?.value2 || '0');
                 result = ltv >= target && ltv <= target2;
            }
            else result = ltv === target;
        } else if (condType === 'first_purchase_product' || condType === 'last_purchase_product') {
            const orderDirection = condType === 'first_purchase_product' ? 'ASC' : 'DESC';
            const sale = await this.saleRepository.createQueryBuilder('sale')
                .where('sale.contactId = :contactId', { contactId: contact.id })
                .orderBy('sale.createdAt', orderDirection)
                .getOne();
            
            if (sale && node.data?.productId) {
                result = sale.productId?.toString() === node.data.productId.toString();
            }
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
