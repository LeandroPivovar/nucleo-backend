import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository, In, MoreThan } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Campaign } from '../../entities/campaign.entity';
import { ZenviaService } from '../../zenvia/zenvia.service';
import { TwilioService, TwilioCredentials } from '../../twilio/twilio.service';
import { ContactsService } from '../../contacts/contacts.service';
import { EmailService } from '../../email/email.service';
import { UserUsage } from '../../entities/user-usage.entity';
import { User } from '../../entities/user.entity';
import { Subscription } from '../../entities/subscription.entity';
import { Contact } from '../../entities/contact.entity';
import { Sale } from '../../entities/sale.entity';
import { TwilioConnectionsService } from '../../twilio-connections/twilio-connections.service';
import { ShopifyService } from '../../shopify/shopify.service';
import { NuvemshopService } from '../../nuvemshop/nuvemshop.service';
import { LojaIntegradaService } from '../../loja-integrada/loja-integrada.service';
import { VtexService } from '../../vtex/vtex.service';
import { TrayService } from '../../tray/tray.service';
import { CampaignQueue } from '../../entities/campaign-queue.entity';
import { ShopifyConnection } from '../../entities/shopify-connection.entity';
import { NuvemshopConnection } from '../../entities/nuvemshop-connection.entity';
import { LojaIntegradaConnection } from '../../entities/loja-integrada-connection.entity';
import { VtexConnection } from '../../entities/vtex-connection.entity';
import { TrayConnection } from '../../entities/tray-connection.entity';
import { CampaignClick } from '../../entities/campaign-click.entity';
import { CampaignCoupon } from '../../entities/campaign-coupon.entity';
import { addMinutes, addHours, addDays, format, differenceInDays } from 'date-fns';

/** Tipos de condição que envolvem verificação de pedidos/compras */
const ORDER_CONDITION_TYPES = [
    'order_placed',
    'product_purchased',
    'order_delivered',
    'order_cancelled',
    'order_awaiting_payment',
    'payment_method',
];


@Injectable()
export class CampaignSchedulerService {
    private readonly logger = new Logger(CampaignSchedulerService.name);
    private isProcessingOrderWait = false;

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
        private twilioService: TwilioService,

        private contactsService: ContactsService,
        private emailService: EmailService,
        private twilioConnectionsService: TwilioConnectionsService,
        private shopifyService: ShopifyService,
        private nuvemshopService: NuvemshopService,
        private lojaIntegradaService: LojaIntegradaService,
        private vtexService: VtexService,
        private trayService: TrayService,
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
        const pendingQueue = await this.campaignQueueRepository
            .createQueryBuilder('q')
            .leftJoinAndSelect('q.campaign', 'campaign')
            .leftJoinAndSelect('q.contact', 'contact')
            .where('(q.type = :type OR q.type IS NULL)', { type: 'delay' })
            .andWhere('q.status = :status', { status: 'pending' })
            .andWhere('q.resumeAt <= :now', { now })
            .getMany();

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

    /**
     * Polling de pedidos para campanhas avançadas.
     * Roda a cada 2 minutos e processa apenas itens do tipo 'order_wait'.
     * Intervalos decrescentes baseados no tempo desde o início da campanha.
     */
    @Cron('*/2 * * * *')
    async processOrderWaitQueue() {
        // Guard: evitar execuções concorrentes (cron pode disparar antes da anterior terminar)
        if (this.isProcessingOrderWait) {
            this.logger.debug('[ORDER_WAIT] Já em execução, pulando esta iteração.');
            return;
        }
        this.isProcessingOrderWait = true;

        try {
            const now = new Date();

            const pendingItems = await this.campaignQueueRepository.find({
                where: {
                    type: 'order_wait',
                    status: 'pending',
                    resumeAt: LessThanOrEqual(now),
                },
                relations: ['campaign', 'contact'],
            });

            if (pendingItems.length === 0) return;

            this.logger.log(`[ORDER_WAIT] Verificando ${pendingItems.length} contatos aguardando pedidos...`);

            // Agrupar por userId para sincronizar vendas uma vez por usuário
            const userIds = [...new Set(pendingItems.map(i => i.userId))];
            for (const userId of userIds) {
                await this.syncNewSalesForUser(userId, now);
            }

            for (const item of pendingItems) {
                try {
                    await this.processOrderWaitItem(item, now);
                } catch (err: any) {
                    this.logger.error(`[ORDER_WAIT] Erro ao processar item ${item.id}: ${err.message}`, err.stack);
                }
            }
        } finally {
            this.isProcessingOrderWait = false;
        }
    }

    private async processOrderWaitItem(item: CampaignQueue, now: Date): Promise<void> {
        const startedAt = item.campaignStartedAt || item.createdAt;
        const daysSinceStart = differenceInDays(now, startedAt);

        // Expirar após 30 dias — tomar branch false (se existir) ou encerrar
        if (daysSinceStart >= 30) {
            this.logger.log(`[ORDER_WAIT] Item ${item.id} expirado após ${daysSinceStart} dias. Tomando branch false ou encerrando.`);
            item.status = 'expired';
            await this.campaignQueueRepository.save(item);
            // Recarregar campanha para garantir config atualizada no resumeFlow
            const expiredCampaign = await this.campaignsRepository.findOne({ where: { id: item.campaignId } });
            if (expiredCampaign) item.campaign = expiredCampaign;
            await this.resumeOrderWaitFlow(item, false);
            return;
        }

        // Calcular próximo intervalo de checagem
        let nextIntervalMinutes: number;
        if (daysSinceStart < 1) {
            nextIntervalMinutes = 2;
        } else if (daysSinceStart < 7) {
            nextIntervalMinutes = 60; // 1 hora
        } else {
            nextIntervalMinutes = 720; // 12 horas
        }

        // Recarregar campanha do banco para garantir config atualizada
        const freshCampaign = await this.campaignsRepository.findOne({ where: { id: item.campaignId } });
        if (!freshCampaign) {
            this.logger.warn(`[ORDER_WAIT] Campanha ${item.campaignId} não encontrada para item ${item.id}. Encerrando.`);
            item.status = 'failed';
            await this.campaignQueueRepository.save(item);
            return;
        }
        // Usar campanha atualizada para lookup do nó
        const conditionNode = freshCampaign.config?.workflow?.nodes?.find(
            (n: any) => n.id === item.waitingNodeId
        );

        if (!conditionNode || !item.contact) {
            this.logger.warn(`[ORDER_WAIT] Dados insuficientes para item ${item.id} (nó: ${item.waitingNodeId}). Encerrando.`);
            item.status = 'failed';
            await this.campaignQueueRepository.save(item);
            return;
        }

        const conditionMet = await this.evaluateCondition(conditionNode, item.contact, freshCampaign, item.eventContext);

        if (conditionMet) {
            this.logger.log(`[ORDER_WAIT] Condição satisfeita para contato ${item.contact.id} na campanha ${freshCampaign.id}. Retomando fluxo pelo branch TRUE.`);
            item.status = 'processing';
            await this.campaignQueueRepository.save(item);
            // Substituir item.campaign pela versão fresca para o resumeFlow
            item.campaign = freshCampaign;
            await this.resumeOrderWaitFlow(item, true);
            item.status = 'completed';
            await this.campaignQueueRepository.save(item);
        } else {
            // Reagendar para próxima verificação
            item.lastCheckedAt = now;
            item.resumeAt = addMinutes(now, nextIntervalMinutes);
            await this.campaignQueueRepository.save(item);
            this.logger.debug(`[ORDER_WAIT] Condição não satisfeita para contato ${item.contact.id}. Próxima checagem em ${nextIntervalMinutes}min.`);
        }
    }

    /** Retoma o fluxo a partir do próximo nó após o nó de condição (pelo branch true ou false). */
    private async resumeOrderWaitFlow(item: CampaignQueue, conditionResult: boolean): Promise<void> {
        try {
            const campaign = item.campaign;
            const contact = item.contact;
            if (!campaign || !contact) return;

            const edges = campaign.config?.workflow?.edges || [];
            const nodes = campaign.config?.workflow?.nodes || [];
            const condNodeId = item.waitingNodeId;

            const matchingEdge = edges.find(
                (e: any) => e.source === condNodeId && e.sourceHandle === (conditionResult ? 'true' : 'false')
            );

            if (!matchingEdge) {
                this.logger.log(`[ORDER_WAIT] Nenhuma edge '${conditionResult ? 'true' : 'false'}' encontrada para nó ${condNodeId}. Fluxo encerrado para contato ${contact.id}.`);
                return;
            }

            const nextNode = nodes.find((n: any) => n.id === matchingEdge.target);
            if (!nextNode) {
                this.logger.log(`[ORDER_WAIT] Próximo nó ${matchingEdge.target} não encontrado. Fluxo encerrado para contato ${contact.id}.`);
                return;
            }

            this.logger.log(`[ORDER_WAIT] Retomando fluxo para contato ${contact.id} no nó ${nextNode.id} (${nextNode.type}).`);
            const context = await this.getExecutionContext(campaign);
            await this.traverseAndExecute(campaign, contact, nextNode, context, item.eventContext, undefined, 0, {});
        } catch (err: any) {
            this.logger.error(`[ORDER_WAIT] Erro ao retomar fluxo para item ${item.id}: ${err.message}`, err.stack);
        }
    }

    /**
     * Sincroniza novas vendas (desde lastCheckedAt) para um usuário,
     * associando-as à campanha via couponCode.
     */
    private async syncNewSalesForUser(userId: number, now: Date): Promise<void> {
        try {
            // Buscar a data da última checagem mais antiga entre os itens pendentes deste usuário
            const oldestItem = await this.campaignQueueRepository.findOne({
                where: { userId, type: 'order_wait', status: 'pending' },
                order: { lastCheckedAt: 'ASC' },
            });
            // Fallback seguro: se não houver registro ou datas nulas, usar 5 minutos atrás
            const sinceDate = (oldestItem?.lastCheckedAt instanceof Date && !isNaN(oldestItem.lastCheckedAt.getTime()))
                ? oldestItem.lastCheckedAt
                : (oldestItem?.createdAt instanceof Date && !isNaN(oldestItem.createdAt.getTime()))
                    ? oldestItem.createdAt
                    : new Date(now.getTime() - 5 * 60 * 1000);

            this.logger.debug(`[ORDER_WAIT] Sincronizando vendas do usuário ${userId} desde ${sinceDate.toISOString()}`);

            const syncPromises: Promise<any>[] = [];

            try {
                const shopifyConn = await this.shopifyService.getActiveConnection(userId);
                if (shopifyConn) {
                    syncPromises.push(
                        this.shopifyService.syncOrders(userId, shopifyConn.shop)
                            .catch(e => this.logger.warn(`[ORDER_WAIT] Shopify sync: ${e.message}`))
                    );
                }
            } catch (_) {}

            try {
                const nuvemConn = await this.nuvemshopService.getActiveConnection(userId);
                if (nuvemConn) {
                    syncPromises.push(
                        this.nuvemshopService.syncOrders(userId, nuvemConn.storeId)
                            .catch(e => this.logger.warn(`[ORDER_WAIT] Nuvemshop sync: ${e.message}`))
                    );
                }
            } catch (_) {}

            try {
                const liConn = await this.lojaIntegradaService.getActiveConnection(userId);
                if (liConn) {
                    syncPromises.push(
                        this.lojaIntegradaService.syncOrders(userId)
                            .catch(e => this.logger.warn(`[ORDER_WAIT] LojaIntegrada sync: ${e.message}`))
                    );
                }
            } catch (_) {}

            try {
                const vtexConn = await this.vtexService.getActiveConnection(userId);
                if (vtexConn) {
                    syncPromises.push(
                        this.vtexService.syncOrders(userId, vtexConn.accountName)
                            .catch(e => this.logger.warn(`[ORDER_WAIT] VTEX sync: ${e.message}`))
                    );
                }
            } catch (_) {}

            if (syncPromises.length > 0) {
                await Promise.allSettled(syncPromises);
            }

            // Associar novas vendas às campanhas via cupom
            await this.associateSalesToCampaignsByCoupon(userId, sinceDate);

        } catch (err: any) {
            this.logger.warn(`[ORDER_WAIT] Erro ao sincronizar vendas do usuário ${userId}: ${err.message}`);
        }
    }

    /**
     * Verifica se novas vendas (com couponCode) correspondem a cupons de campanhas ativas
     * e as associa (seta campaignId) na tabela sales.
     */
    private async associateSalesToCampaignsByCoupon(userId: number, sinceDate: Date): Promise<void> {
        try {
            // Buscar vendas recentes sem campaignId mas com couponCode
            const recentSales = await this.saleRepository
                .createQueryBuilder('sale')
                .where('sale.userId = :userId', { userId })
                .andWhere('sale.createdAt >= :sinceDate', { sinceDate })
                .andWhere('sale.couponCode IS NOT NULL')
                .andWhere('sale.campaignId IS NULL')
                .getMany();

            if (recentSales.length === 0) return;

            // Buscar cupons ativos das campanhas deste usuário
            const couponCodes = [...new Set(recentSales.map(s => s.couponCode).filter((c): c is string => !!c))];
            if (couponCodes.length === 0) return; // Guarda contra IN() vazio que quebra no TypeORM

            const campaignCoupons = await this.campaignCouponRepository
                .createQueryBuilder('cc')
                .where('cc.userId = :userId', { userId })
                .andWhere('cc.code IN (:...codes)', { codes: couponCodes })
                .getMany();

            if (campaignCoupons.length === 0) return;

            // Mapa: código → campaignId
            const couponToCampaign = new Map<string, number>();
            const couponToContact = new Map<string, number>();
            for (const cc of campaignCoupons) {
                couponToCampaign.set(cc.code, cc.campaignId);
                couponToContact.set(cc.code, cc.contactId);
            }

            for (const sale of recentSales) {
                const campaignId = couponToCampaign.get(sale.couponCode);
                if (campaignId) {
                    sale.campaignId = campaignId;
                    // Associar contactId se ainda não tiver
                    if (!sale.contactId) {
                        sale.contactId = couponToContact.get(sale.couponCode) ?? sale.contactId;
                    }
                    await this.saleRepository.save(sale);
                    this.logger.log(`[ORDER_WAIT] Venda ${sale.id} associada à campanha ${campaignId} via cupom '${sale.couponCode}'.`);
                }
            }
        } catch (err: any) {
            this.logger.warn(`[ORDER_WAIT] Erro ao associar vendas via cupom: ${err.message}`);
        }
    }

    async processCampaign(campaign: Campaign) {
        const backendUrl = process.env.BACKEND_URL || 'https://nucleocrm.com.br';
        this.logger.log(`Iniciando processamento da campanha [ID: ${campaign.id}] - Canal: ${campaign.channel} | Backend URL: ${backendUrl}`);

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

        // Pre-generate coupons if needed (Single coupon per campaign run)
        const preGeneratedCoupons: Record<string, string> = {};
        
        // Helper to synthesize nodes for simple campaigns to check for coupon needs
        let nodesToCheck: any[] = [];
        if (campaign.complexity === 'simple') {
            if (campaign.config?.campaignConfig?.enableCoupon) nodesToCheck.push({ id: 'simple-coupon', type: 'coupon', data: campaign.config.campaignConfig.coupon });
            if (campaign.config?.campaignConfig?.enableGiftback) nodesToCheck.push({ id: 'simple-giftback', type: 'giftback', data: campaign.config.campaignConfig.giftback });
            if (campaign.config?.campaignConfig?.enableShippingCoupon) nodesToCheck.push({ id: 'simple-shipping', type: 'shipping_coupon', data: campaign.config.campaignConfig.shippingCoupon });
        } else {
            nodesToCheck = campaign.config?.workflow?.nodes || [];
        }

        for (const node of nodesToCheck) {
            if (node.type === 'coupon' || node.type === 'giftback' || node.type === 'shipping_coupon') {
                try {
                    const code = await this.generateSharedCoupon(campaign, node, targetContacts.length, context);
                    if (code) {
                        preGeneratedCoupons[node.id] = code;
                        this.logger.log(`[COUPON PRE-GEN] Gerado código compartilhado para nó ${node.id} (${node.type}): ${code} (Limite: ${targetContacts.length})`);
                    }
                } catch (e) {
                    this.logger.error(`[COUPON PRE-GEN] Erro ao gerar código compartilhado para nó ${node.id}: ${e.message}`);
                }
            }
        }

        if (campaign.complexity === 'advanced' || campaign.complexity === 'predefined') {
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
                        await this.traverseAndExecute(campaign, contact, node, context, undefined, undefined, 0, preGeneratedCoupons);
                    }
                }
            }
            return;
        }

        // --- Simple Campaign Logic (Sequential) ---
        let simpleNodes: any[] = [];
        this.logger.log(`Campanha simples: Sintetizando nós a partir da configuração básica.`);
        if (campaign.config?.campaignConfig?.enableCoupon) {
            simpleNodes.push({ id: 'simple-coupon', type: 'coupon', data: campaign.config.campaignConfig.coupon });
        }
        if (campaign.config?.campaignConfig?.enableGiftback) {
            simpleNodes.push({ id: 'simple-giftback', type: 'giftback', data: campaign.config.campaignConfig.giftback });
        }
        if (campaign.config?.campaignConfig?.enableShippingCoupon) {
            simpleNodes.push({ id: 'simple-shipping', type: 'shipping_coupon', data: campaign.config.campaignConfig.shippingCoupon });
        }
        // Adiciona o nó principal da mensagem
        simpleNodes.push({
            id: 'simple-message',
            type: campaign.channel,
            data: {
                ...campaign.config.email,
                destinationUrl: campaign.config.tracking?.destinationUrl
            }
        });

        this.logger.log(`Iniciando processamento em lote (Batch Size: ${BATCH_SIZE}) para campanha simples [ID: ${campaign.id}]`);
        
        // Log template info for debugging media/variables
        const whatsappNode = simpleNodes.find(n => n.type === 'whatsapp');
        if (whatsappNode?.data?.contentSid) {
            try {
                const verifiedConnection = await this.twilioConnectionsService.getVerifiedConnection(campaign.userId);
                let twilioCredentials: TwilioCredentials | undefined;
                if (verifiedConnection) {
                    twilioCredentials = {
                        accountSid: verifiedConnection.accountSid,
                        authToken: this.twilioService.decryptAuthToken(verifiedConnection.authToken),
                        whatsappFrom: verifiedConnection.whatsappFrom,
                    };
                }
                const tpl = await this.twilioService.getTemplates(twilioCredentials).then(tpls => tpls.find(t => t.sid === whatsappNode.data.contentSid));
                if (tpl) {
                    this.logger.log(`[TWILIO TEMPLATE INFO] SID: ${tpl.sid} | Types: ${JSON.stringify(tpl.types)} | Variables: ${JSON.stringify(tpl.variables)}`);
                }
            } catch (e) {
                this.logger.warn(`Erro ao buscar info do template para log: ${e.message}`);
            }
        }

        for (let i = 0; i < targetContacts.length; i += BATCH_SIZE) {
            const batch = targetContacts.slice(i, i + BATCH_SIZE);
            this.logger.log(`Processando lote ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} contatos)`);

            const batchPromises = batch.map(async (contact) => {
                let stats = { sentEmailCount: 0, sentSmsCount: 0, sentWhatsappCount: 0 };
                let activeCoupon: any = null;

                for (const node of simpleNodes) {
                    const result = await this.processSingleNode(campaign, contact, node, context, activeCoupon, stats, preGeneratedCoupons);
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

        let lojaIntegradaConnection: LojaIntegradaConnection | null = null;
        try { lojaIntegradaConnection = await this.lojaIntegradaService.getActiveConnection(campaign.userId); } catch (e) { }

        let vtexConnection: VtexConnection | null = null;
        try { vtexConnection = await this.vtexService.getActiveConnection(campaign.userId); } catch (e) { }

        let trayConnection: TrayConnection | null = null;
        try { trayConnection = await this.trayService.getActiveConnection(campaign.userId); } catch (e) { }

        return {
            usage,
            subscription,
            user,
            shopifyConnection,
            nuvemshopConnection,
            lojaIntegradaConnection,
            vtexConnection,
            trayConnection,
            planEmailsLimit: subscription?.plan?.limits?.emails || 0,
            planSmsLimit: subscription?.plan?.limits?.sms || 0,
            planWhatsappLimit: subscription?.plan?.limits?.whatsappLimit || 0,
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

    private async traverseAndExecute(campaign: Campaign, contact: Contact, startNode: any, context: any, eventContext?: any, activeCoupon?: any, depth = 0, preGeneratedCoupons: Record<string, string> = {}) {
        if (depth > 50) return;

        const nodes = campaign.config?.workflow?.nodes || [];
        const edges = campaign.config?.workflow?.edges || [];

        let currentNode = startNode;
        let stats = { sentEmailCount: 0, sentSmsCount: 0, sentWhatsappCount: 0 };
        let currentActiveCoupon = activeCoupon;
        const preProcessedNodeIds = new Set<string>(); // nodes already executed by look-ahead

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
                    status: 'pending',
                    type: 'delay',  // garantir que o campo type seja preenchido
                });
                this.logger.log(`Paused workflow for contact ${contact.id} at node ${currentNode.id}. Resume: ${resumeAt}`);
                return;
            }

            // ── Coupon look-ahead for message nodes ──────────────────────────
            // If this is a message node and we don't have an active coupon yet,
            // check if any coupon/giftback node is DIRECTLY connected (in either
            // direction) so that both `email → coupon` and `coupon → email` work.
            const isMessageNode = (currentNode.type === 'email' || currentNode.type === 'sms' || currentNode.type === 'whatsapp');
            if (isMessageNode && !currentActiveCoupon) {
                // Find all node IDs directly connected to the current node via any edge
                const adjacentNodeIds = edges
                    .filter((e: any) => e.source === currentNode.id || e.target === currentNode.id)
                    .map((e: any) => e.source === currentNode.id ? e.target : e.source)
                    .filter((id: string) => id !== currentNode.id);

                for (const adjId of adjacentNodeIds) {
                    const adjNode = nodes.find((n: any) => n.id === adjId);
                    if (adjNode && (adjNode.type === 'coupon' || adjNode.type === 'giftback')) {
                        this.logger.log(`[COUPON LOOK-AHEAD] Found ${adjNode.type} node (${adjId}) adjacent to ${currentNode.type} node (${currentNode.id}) for contact ${contact.id}`);
                        // Pre-process the coupon node to populate currentActiveCoupon
                        const couponResult = await this.processSingleNode(campaign, contact, adjNode, context, null, stats, preGeneratedCoupons);
                        if (couponResult.activeCoupon) {
                            currentActiveCoupon = couponResult.activeCoupon;
                            preProcessedNodeIds.add(adjId); // mark as already processed
                            this.logger.log(`[COUPON LOOK-AHEAD] Coupon pre-loaded: ${currentActiveCoupon._generatedCode || currentActiveCoupon.couponName || 'unnamed'}`);
                        }
                        break; // Use first coupon found
                    }
                }
            }
            // ─────────────────────────────────────────────────────────────────

            // Skip this node if it was already executed by look-ahead (avoid double coupon generation)
            if (preProcessedNodeIds.has(currentNode.id)) {
                this.logger.debug(`[FLOW] Skipping node ${currentNode.id} (${currentNode.type}) — already executed by look-ahead`);
            } else {
                const result = await this.processSingleNode(campaign, contact, currentNode, context, currentActiveCoupon, stats, preGeneratedCoupons);
                if (result.activeCoupon) currentActiveCoupon = result.activeCoupon;
            }

            let nextNodeId: string | undefined;
            if (currentNode.type === 'condition') {
                const condType: string | undefined = currentNode.data?.conditionType || currentNode.data?.type;
                const conditionResult = await this.evaluateCondition(currentNode, contact, campaign, eventContext);

                // Verificar se condição de pedido falhou e não há branch false conectado
                if (!conditionResult && condType && ORDER_CONDITION_TYPES.includes(condType)) {
                    const hasFalseBranch = edges.some(
                        (e: any) => e.source === currentNode.id && e.sourceHandle === 'false'
                    );

                    if (!hasFalseBranch) {
                        // Salvar stats acumuladas antes de pausar (senão o return pula a contabilização no fim do loop)
                        if (stats.sentEmailCount + stats.sentSmsCount + stats.sentWhatsappCount > 0) {
                            campaign.sentCount = (campaign.sentCount || 0) + stats.sentEmailCount + stats.sentSmsCount + stats.sentWhatsappCount;
                            await this.campaignsRepository.save(campaign);
                            stats.sentEmailCount = 0; stats.sentSmsCount = 0; stats.sentWhatsappCount = 0;
                        }

                        // Enfileirar para polling — aguardar o pedido acontecer
                        const now = new Date();
                        const resumeAt = addMinutes(now, 2);
                        await this.campaignQueueRepository.save({
                            userId: campaign.userId,
                            campaign,
                            contact,
                            delayNodeId: currentNode.id,
                            waitingNodeId: currentNode.id,
                            resumeAt,
                            campaignStartedAt: now,
                            lastCheckedAt: now,
                            eventContext: { ...(eventContext || {}), waitingFor: condType },
                            status: 'pending',
                            type: 'order_wait',
                        });
                        this.logger.log(`[ORDER_WAIT] Contato ${contact.id} enfileirado aguardando pedido (${condType}) na campanha ${campaign.id}. Próxima checagem em 2 min.`);
                        return; // Pausar o fluxo — será retomado pelo processOrderWaitQueue
                    }
                }

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

    private async processSingleNode(campaign: Campaign, contact: Contact, node: any, context: any, activeCoupon: any, stats: any, preGeneratedCoupons: Record<string, string> = {}) {
        const { usage, user, shopifyConnection, nuvemshopConnection, lojaIntegradaConnection, vtexConnection, trayConnection, planEmailsLimit, planSmsLimit, backendUrl } = context;
        let newActiveCoupon = activeCoupon;

        const currentEmailsSent = Number(usage.emailsSent) || 0;
        const currentSmsSent = Number(usage.smsSent) || 0;
        const currentWhatsappSent = Number(usage.whatsappSent) || 0;

        if (node.type === 'coupon' || node.type === 'giftback' || node.type === 'shipping_coupon') {
            this.logger.log(`[NODE EXECUTING] ${node.type.toUpperCase()} | Campaign ID: ${campaign.id} | Contact ID: ${contact.id}`);
            newActiveCoupon = { ...node.data, _type: node.type };
            
            const days = parseInt(node.data?.expirationDays || '30');
            const endsAt = new Date();
            endsAt.setDate(endsAt.getDate() + days);
            const endsAtIso = endsAt.toISOString();

            if (preGeneratedCoupons[node.id]) {
                newActiveCoupon._generatedCode = preGeneratedCoupons[node.id];
                this.logger.debug(`[COUPON] Usando código compartilhado para nó ${node.id}: ${newActiveCoupon._generatedCode}`);
            } else if (node.type === 'giftback') {
                const val = node.data?.giftValue || node.data?.giftbackValue || '0';
                const code = node.data?.couponName || `GIFT_${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

                if (shopifyConnection) {
                    try {
                        this.logger.log(`[GIFTCARD] Gerando via Shopify para contato ${contact.id}`);
                        const gc = await this.shopifyService.createGiftCard(campaign.userId, shopifyConnection.shop, { initialValue: val, note: 'GIFTBACK', endsAt: endsAtIso });
                        newActiveCoupon._generatedCode = gc.code;
                        this.logger.log(`[GIFTCARD] Código gerado: ${gc.code}`);
                    } catch (e) {
                        this.logger.error(`[GIFTCARD] Erro ao gerar via Shopify: ${e.message}`);
                    }
                } else if (nuvemshopConnection) {
                    try {
                        this.logger.log(`[COUPON] Gerando via Nuvemshop para contato ${contact.id}`);
                        await this.nuvemshopService.createCoupon(campaign.userId, nuvemshopConnection.storeId, { code, type: 'absolute', value: val, start_date: new Date().toISOString(), end_date: endsAtIso, max_uses: 1 });
                        newActiveCoupon._generatedCode = code;
                        this.logger.log(`[COUPON] Código gerado: ${code}`);
                    } catch (e) {
                        this.logger.error(`[COUPON] Erro ao gerar via Nuvemshop: ${e.message}`);
                    }
                } else if (vtexConnection) {
                    try {
                        this.logger.log(`[COUPON/VTEX] Gerando cupom via VTEX para contato ${contact.id}`);
                        await this.vtexService.createCoupon(campaign.userId, vtexConnection.accountName, {
                            couponCode: code,
                            utmSource: 'nucleo-crm',
                            utmCampaign: campaign.id.toString()
                        });
                        newActiveCoupon._generatedCode = code;
                    } catch (e) {
                        this.logger.error(`[COUPON/VTEX] Erro ao gerar via VTEX: ${e.message}`);
                    }
                } else {
                    // Loja Integrada giftback (como cupom fixo)
                    try {
                        const liConn = lojaIntegradaConnection || await this.lojaIntegradaService.getActiveConnection(campaign.userId);
                        if (liConn) {
                            this.logger.log(`[GIFTCARD/COUPON] Gerando via Loja Integrada para contato ${contact.id}`);
                            await this.lojaIntegradaService.createCoupon(campaign.userId, {
                                codigo: code,
                                tipo: 'fixo',
                                validade: endsAtIso,
                                valor_minimo: '0',
                                quantidade: 1,
                                quantidade_por_cliente: 1,
                                descricao: 'GIFTBACK'
                            });
                            newActiveCoupon._generatedCode = code;
                        }
                    } catch (e) {
                        this.logger.error(`[GIFTCARD/COUPON] Erro ao gerar via Loja Integrada: ${e.message}`);
                    }
                }
            } else if (node.type === 'coupon') {
                const val = node.data?.discountValue || '0';
                const type = node.data?.discountType || 'percentage'; // 'percentage' | 'fixed'
                const code = node.data?.couponName || `CUPOM_${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
                
                if (shopifyConnection) {
                    try {
                        this.logger.log(`[COUPON] Gerando via Shopify para contato ${contact.id}`);
                        await this.shopifyService.createDiscountCode(campaign.userId, shopifyConnection.shop, {
                            title: 'Campanha CRM',
                            code,
                            value: val,
                            valueType: type === 'percentage' ? 'percentage' : 'fixed',
                            endsAt: endsAtIso
                        });
                        newActiveCoupon._generatedCode = code;
                    } catch (e) {
                        this.logger.error(`[COUPON] Erro ao gerar via Shopify: ${e.message}`);
                    }
                } else if (nuvemshopConnection) {
                    try {
                        this.logger.log(`[COUPON] Gerando via Nuvemshop para contato ${contact.id}`);
                        await this.nuvemshopService.createCoupon(campaign.userId, nuvemshopConnection.storeId, {
                            code,
                            type: type === 'percentage' ? 'percentage' : 'absolute',
                            value: val,
                            start_date: new Date().toISOString(),
                            end_date: endsAtIso,
                            max_uses: 1
                        });
                        newActiveCoupon._generatedCode = code;
                    } catch (e) {
                        this.logger.error(`[COUPON] Erro ao gerar via Nuvemshop: ${e.message}`);
                    }
                } else if (vtexConnection) {
                    try {
                        this.logger.log(`[COUPON/VTEX] Gerando cupom via VTEX para contato ${contact.id}`);
                        await this.vtexService.createCoupon(campaign.userId, vtexConnection.accountName, {
                            couponCode: code,
                            utmSource: 'nucleo-crm',
                            utmCampaign: campaign.id.toString()
                        });
                        newActiveCoupon._generatedCode = code;
                    } catch (e) {
                        this.logger.error(`[COUPON/VTEX] Erro ao gerar via VTEX: ${e.message}`);
                    }
                } else {
                    try {
                        const liConn = lojaIntegradaConnection || await this.lojaIntegradaService.getActiveConnection(campaign.userId);
                        if (liConn) {
                            this.logger.log(`[COUPON] Gerando via Loja Integrada para contato ${contact.id}`);
                            await this.lojaIntegradaService.createCoupon(campaign.userId, {
                                codigo: code,
                                tipo: type === 'percentage' ? 'porcentagem' : 'fixo',
                                validade: endsAtIso,
                                quantidade: 1,
                                quantidade_por_cliente: 1
                            });
                            newActiveCoupon._generatedCode = code;
                        }
                    } catch (e) {
                        this.logger.error(`[COUPON] Erro ao gerar via Loja Integrada: ${e.message}`);
                    }
                }
            } else if (node.type === 'shipping_coupon') {
                const code = node.data?.code || `FRETE_${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

                if (shopifyConnection) {
                    try {
                        this.logger.log(`[SHIPPING_COUPON] Gerando via Shopify para contato ${contact.id}`);
                        await this.shopifyService.createFreeShippingDiscountCode(campaign.userId, shopifyConnection.shop, {
                            title: 'FRETE GRÁTIS',
                            code,
                            endsAt: endsAtIso,
                            minimumSubtotal: node.data?.minPurchaseValue || '0',
                            usageLimit: 1
                        });
                        newActiveCoupon._generatedCode = code;
                    } catch (e) {
                        this.logger.error(`[SHIPPING_COUPON] Erro ao gerar via Shopify: ${e.message}`);
                    }
                } else if (nuvemshopConnection) {
                    try {
                        this.logger.log(`[SHIPPING_COUPON] Gerando via Nuvemshop para contato ${contact.id}`);
                        await this.nuvemshopService.createCoupon(campaign.userId, nuvemshopConnection.storeId, {
                            code,
                            type: 'shipping',
                            start_date: new Date().toISOString(),
                            end_date: endsAtIso,
                            min_price: node.data?.minPurchaseValue || 0,
                            max_uses: 1,
                            only_cheapest_shipping: true
                        });
                        newActiveCoupon._generatedCode = code;
                    } catch (e) {
                        this.logger.error(`[SHIPPING_COUPON] Erro ao gerar via Nuvemshop: ${e.message}`);
                    }
                } else if (vtexConnection) {
                    try {
                        this.logger.log(`[SHIPPING_COUPON/VTEX] Gerando cupom via VTEX para contato ${contact.id}`);
                        await this.vtexService.createCoupon(campaign.userId, vtexConnection.accountName, {
                            couponCode: code,
                            utmSource: 'nucleo-crm',
                            utmCampaign: campaign.id.toString()
                        });
                        newActiveCoupon._generatedCode = code;
                    } catch (e) {
                        this.logger.error(`[SHIPPING_COUPON/VTEX] Erro ao gerar via VTEX: ${e.message}`);
                    }
                } else {
                    // Loja Integrada (via Active Connection)
                    try {
                        const liConn = lojaIntegradaConnection || await this.lojaIntegradaService.getActiveConnection(campaign.userId);
                        if (liConn) {
                            this.logger.log(`[SHIPPING_COUPON] Gerando via Loja Integrada para contato ${contact.id}`);
                            await this.lojaIntegradaService.createCoupon(campaign.userId, {
                                codigo: code,
                                tipo: 'frete_gratis',
                                validade: endsAtIso,
                                valor_minimo: node.data?.minPurchaseValue || '0',
                                quantidade: 1,
                                quantidade_por_cliente: 1
                            });
                            newActiveCoupon._generatedCode = code;
                        }
                    } catch (e) {
                        this.logger.error(`[SHIPPING_COUPON] Erro ao gerar via Loja Integrada: ${e.message}`);
                    }
                }
            }

            // Persistir o cupom gerado ou definido no banco de dados para segmentação
            if (newActiveCoupon && (newActiveCoupon._generatedCode || newActiveCoupon.couponName)) {
                try {
                    const couponEndsAt = newActiveCoupon.validityDate ? new Date(newActiveCoupon.validityDate) : endsAt;

                    await this.campaignCouponRepository.save({
                        userId: campaign.userId,
                        campaignId: campaign.id,
                        contactId: contact.id,
                        name: newActiveCoupon.couponName || (node.type === 'giftback' ? 'Giftback' : (node.type === 'shipping_coupon' ? 'Frete Grátis' : 'Cupom')),
                        code: newActiveCoupon._generatedCode || newActiveCoupon.couponName,
                        platform: shopifyConnection ? 'shopify' : (nuvemshopConnection ? 'nuvemshop' : (lojaIntegradaConnection ? 'loja_integrada' : (vtexConnection ? 'vtex' : (trayConnection ? 'tray' : 'internal')))),
                        value: parseFloat(newActiveCoupon.discountValue || newActiveCoupon.giftValue || newActiveCoupon.giftbackValue || '0'),
                        type: newActiveCoupon.discountType || (node.type === 'giftback' ? 'absolute' : (node.type === 'shipping_coupon' ? 'shipping' : 'percentage')),
                        startsAt: new Date(),
                        endsAt: couponEndsAt
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
                let code = '';
                let valStr = '';
                let validity = '';

                if (newActiveCoupon) {
                    const val = newActiveCoupon.discountValue || newActiveCoupon.giftValue || newActiveCoupon.giftbackValue || '0';
                    valStr = newActiveCoupon.discountType === 'percentage' ? `${val}%` : `R$ ${val}`;
                    code = newActiveCoupon._generatedCode || newActiveCoupon.couponName || 'CUPOM';

                    validity = '';
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

                    // Auto-append if no variables used
                    if (!hasVariables) {
                        content += `<br/><br/>CUPOM: ${code}<br/>DESCONTO: ${valStr}<br/>DATA DE VALIDADE: ${validity}`;
                    }

                }
                const extraVars: Record<string, string> = {
                    link_rastreio: `${backendUrl}/api/campaigns/track/${campaign.id}?contactId=${contact.id}`,
                    cupom_nome: code,
                    cupom_valor: valStr,
                    cupom_validade: validity,
                };
                content = this.resolveText(content, contact, extraVars);

                // Coletar mídias do nó para anexar
                const attachments = (node.data?.media || []).map((m: any) => ({
                    filename: m.name,
                    path: m.url
                }));

                try {
                    await this.emailService.sendEmail({ 
                        to: contact.email, 
                        subject: node.data?.subject || 'Nova Campanha', 
                        html: content, 
                        text: content.replace(/<[^>]*>?/gm, ''),
                        attachments
                    });
                    stats.sentEmailCount++;
                    usage.emailsSent = (Number(usage.emailsSent) || 0) + 1;
                    await this.userUsageRepository.save(usage);
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
                let code = '';
                let valStr = '';
                let validity = '';

                if (newActiveCoupon) {
                    const val = newActiveCoupon.discountValue || newActiveCoupon.giftValue || newActiveCoupon.giftbackValue || '0';
                    valStr = newActiveCoupon.discountType === 'percentage' ? `${val}%` : `R$ ${val}`;
                    code = newActiveCoupon._generatedCode || newActiveCoupon.couponName || 'CUPOM';

                    validity = '';
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

                    if (!hasVariables) {
                        content += `\n\nCUPOM: ${code}\nDESCONTO: ${valStr}\nDATA DE VALIDADE: ${validity}`;
                    }
                }
                const nodeDest = node.data?.destinationUrl || campaign.config?.tracking?.destinationUrl || '';
                const trackingUrl = `${backendUrl}/api/campaigns/track/${campaign.id}?contactId=${contact.id}${nodeDest ? `&dest=${encodeURIComponent(nodeDest)}` : ''}`;
                const extraVars: Record<string, string> = {
                    link_rastreio: trackingUrl,
                    cupom_nome: code,
                    cupom_valor: valStr,
                    cupom_validade: validity,
                };
                content = this.resolveText(content, contact, extraVars);
                try {
                    const success = await this.zenviaService.sendSms(contact.name || 'Contato', contact.phone, content);
                    if (success) {
                        stats.sentSmsCount++;
                        usage.smsSent = (Number(usage.smsSent) || 0) + 1;
                        await this.userUsageRepository.save(usage);
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
            
            // ── Bloqueio de envio sem template ───────────────────────────────────────
            const contentSid: string | undefined = node.data?.contentSid;
            if (!contentSid) {
                this.logger.warn(`[CAMPAIGN WHATSAPP BLOCKED] Template (ContentSid) obrigatório para envios proativos | Contact: ${contact.id}`);
                return { activeCoupon: newActiveCoupon };
            }

            // ── Controle de Limite (Plano + Extra Balance) ──────────────────────────
            const planWhatsappLimit = context.planWhatsappLimit || 0;
            const isUnlimited = planWhatsappLimit === -1;
            
            if (isUnlimited || currentWhatsappSent < planWhatsappLimit || (user?.extraWhatsappBalance || 0) > 0) {
                let content = node.data?.content || 'Olá!';
                const nodeDest = node.data?.destinationUrl || campaign.config?.tracking?.destinationUrl || '';
                const trackUrl = `${backendUrl}/api/campaigns/track/${campaign.id}?contactId=${contact.id}${nodeDest ? `&dest=${encodeURIComponent(nodeDest)}` : ''}`;

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

                    if (!hasVariables) {
                        content += `\n\nCUPOM: ${code}\nDESCONTO: ${valStr}\nDATA DE VALIDADE: ${validity} dias`;
                    }
                }

                content = content.replace(/{{link_rastreio}}/g, trackUrl);

                // Sempre usar Twilio para Campanhas
                const verifiedConnection = await this.twilioConnectionsService.getVerifiedConnection(campaign.userId);

                let twilioCredentials: TwilioCredentials | undefined;
                if (verifiedConnection) {
                    twilioCredentials = {
                        accountSid: verifiedConnection.accountSid,
                        authToken: this.twilioService.decryptAuthToken(verifiedConnection.authToken),
                        whatsappFrom: verifiedConnection.whatsappFrom,
                    };
                }

                let success = false;
                const twilioStatusCallback = `${backendUrl}/api/campaigns/webhook/twilio-status?campaignId=${campaign.id}&contactId=${contact.id}`;

                // Modo template aprovado: substitui variáveis do template
                const templateVars: Record<string, string> = {
                    ...(node.data?.templateVariables || {}),
                };

                let code = 'CUPOM';
                let valStr = '0';
                let validity = '30 dias';

                if (newActiveCoupon) {
                    const val = newActiveCoupon.discountValue || newActiveCoupon.giftValue || newActiveCoupon.giftbackValue || '0';
                    valStr = newActiveCoupon.discountType === 'percentage' ? `${val}%` : `R$ ${val}`;
                    code = newActiveCoupon._generatedCode || newActiveCoupon.couponName || 'CUPOM';

                    if (newActiveCoupon.validityDate) {
                        try {
                            validity = format(new Date(newActiveCoupon.validityDate), 'dd/MM/yyyy');
                        } catch (e) {
                            validity = newActiveCoupon.expirationDays ? `${newActiveCoupon.expirationDays} dias` : '30 dias';
                        }
                    } else {
                        validity = newActiveCoupon.expirationDays ? `${newActiveCoupon.expirationDays} dias` : '30 dias';
                    }
                }

                Object.keys(templateVars).forEach(key => {
                    if (typeof templateVars[key] === 'string') {
                        templateVars[key] = this.resolveText(templateVars[key], contact, {
                            cupom_nome: code,
                            cupom_valor: valStr,
                            cupom_validade: validity,
                            link_rastreio: trackUrl
                        });
                    }
                });

                // Remove empty strings to avoid Twilio 400 errors or failures
                // AND: Ensure media URLs are absolute using backendUrl
                Object.keys(templateVars).forEach(key => {
                    const value = templateVars[key];
                    const isEmpty = value === '' || value === null || value === undefined;
                    
                    if (isEmpty) {
                        delete templateVars[key];
                    } else if (typeof value === 'string') {
                        // Se a URL for relativa (começa com /api), torna absoluta
                        if (value.startsWith('/api/')) {
                            templateVars[key] = `${backendUrl}${value}`;
                        }
                        // Se a URL apontar para localhost mas o backendUrl for diferente (produção), corrige
                        else if (value.includes('localhost:3000') && !backendUrl.includes('localhost:3000')) {
                            templateVars[key] = value.replace(/http:\/\/localhost:3000/g, backendUrl);
                        }
                    }
                });

                this.logger.log(`[TWILIO TEMPLATE] contentSid: ${contentSid} | vars: ${JSON.stringify(templateVars)}`);
                success = await this.twilioService.sendWhatsAppTemplate(
                    contact.phone,
                    contentSid,
                    templateVars,
                    twilioCredentials,
                    { statusCallback: twilioStatusCallback },
                );

                if (success) {
                    stats.sentWhatsappCount++;
                    usage.whatsappSent = (Number(usage.whatsappSent) || 0) + 1;
                    await this.userUsageRepository.save(usage);
                    
                    // Deduct from extra balance if we already used up the plan limit
                    if (!isUnlimited && currentWhatsappSent >= planWhatsappLimit && user && user.extraWhatsappBalance > 0) {
                        user.extraWhatsappBalance--;
                        await this.userRepository.save(user);
                    }
                    
                    this.logger.log(`[CAMPAIGN WHATSAPP EXECUTED] Sucesso | Contact: ${contact.id}`);
                } else {
                    this.logger.error(`[CAMPAIGN WHATSAPP EXECUTED] Rejeitado pelo provedor | Contact: ${contact.id}`);
                }
            } else {
                this.logger.warn(`[CAMPAIGN WHATSAPP EXECUTED] Limite atingido | User ID: ${campaign.userId} | Contact ID: ${contact.id}`);
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

            // Verificar se esta é a última campanha ativa do usuário
            const latestCampaign = await this.campaignsRepository.findOne({
                where: { userId: campaign.userId },
                order: { createdAt: 'DESC' },
            });
            const isLatestCampaign = latestCampaign?.id === campaignId;

            if (isLatestCampaign) {
                // Última campanha: aceitar vendas vinculadas por cupom OU por data (sem cupom)
                query.andWhere('(sale.campaignId = :campaignId OR sale.createdAt >= :campaignDate)', {
                    campaignId,
                    campaignDate: campaign.createdAt
                });
            } else {
                // Campanhas anteriores: só aceitar vendas explicitamente vinculadas via cupom
                query.andWhere('sale.campaignId = :campaignId', { campaignId });
            }

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
            
            if (recentSale) {
                this.logger.debug(`[CONDITION_MATCH] Venda encontrada para contato ${contact.id}. SaleID: ${recentSale.id}, SaleDate: ${recentSale.createdAt}, CampaignDate: ${campaign.createdAt}`);
            } else {
                this.logger.debug(`[CONDITION_NO_MATCH] Nenhuma venda encontrada para contato ${contact.id} seguindo os critérios (Latest: ${isLatestCampaign}, CampaignDate: ${campaign.createdAt})`);
            }

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

    private resolveText(text: string, contact: Contact, extraVars: Record<string, string>): string {
        if (!text) return '';
        let resolved = text;

        // Dynamic Contact fields mapping
        const contactMap: Record<string, any> = {
            nome: contact.name,
            sobrenome: contact.lastName,
            email: contact.email,
            telefone: contact.phone,
            empresa: contact.company,
            cargo: contact.position,
            cidade: contact.city,
            estado: contact.state,
            id: contact.id,
            status: contact.status,
            origem: contact.source,
            notas: contact.notes,
        };

        // Extra fields from Contact entity (can be extended here)
        Object.keys(contactMap).forEach(key => {
            const val = contactMap[key];
            const regex = new RegExp(`{{${key}}}`, 'g');
            // If it's the name and it's missing, use 'Cliente' as fallback
            const fallback = key === 'nome' ? 'Cliente' : '';
            resolved = resolved.replace(regex, val || fallback);
        });

        // Extra variables passed (coupon, tracking, etc)
        Object.keys(extraVars).forEach(key => {
            const val = extraVars[key];
            const regex = new RegExp(`{{${key}}}`, 'g');
            resolved = resolved.replace(regex, val || '');
        });

        return resolved;
    }
    
    private async generateSharedCoupon(campaign: Campaign, node: any, recipientsCount: number, context: any): Promise<string | null> {
        const { shopifyConnection, nuvemshopConnection, lojaIntegradaConnection, vtexConnection } = context;
        const days = parseInt(node.data?.expirationDays || '30');
        const endsAt = new Date();
        endsAt.setDate(endsAt.getDate() + days);
        const endsAtIso = endsAt.toISOString();

        if (node.type === 'giftback') {
            const val = node.data?.giftValue || node.data?.giftbackValue || '0';
            const code = node.data?.couponName || `GIFT_${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

            if (shopifyConnection) {
                const gc = await this.shopifyService.createGiftCard(campaign.userId, shopifyConnection.shop, { initialValue: val, note: 'GIFTBACK SHARED', endsAt: endsAtIso });
                return gc.code;
            } else if (nuvemshopConnection) {
                await this.nuvemshopService.createCoupon(campaign.userId, nuvemshopConnection.storeId, { code, type: 'absolute', value: val, start_date: new Date().toISOString(), end_date: endsAtIso, max_uses: recipientsCount });
                return code;
            } else if (vtexConnection) {
                await this.vtexService.createCoupon(campaign.userId, vtexConnection.accountName, { couponCode: code, utmSource: 'nucleo-crm', utmCampaign: campaign.id.toString() });
                return code;
            } else if (lojaIntegradaConnection) {
                await this.lojaIntegradaService.createCoupon(campaign.userId, { codigo: code, tipo: 'fixo', validade: endsAtIso, valor_minimo: '0', quantidade: recipientsCount, quantidade_por_cliente: 1, descricao: 'GIFTBACK SHARED' });
                return code;
            }
        } else if (node.type === 'coupon') {
            const val = node.data?.discountValue || '0';
            const type = node.data?.discountType || 'percentage';
            const code = node.data?.couponName || `CUPOM_${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

            if (shopifyConnection) {
                await this.shopifyService.createDiscountCode(campaign.userId, shopifyConnection.shop, { title: 'Campanha CRM', code, value: val, valueType: type === 'percentage' ? 'percentage' : 'fixed', endsAt: endsAtIso });
                return code;
            } else if (nuvemshopConnection) {
                await this.nuvemshopService.createCoupon(campaign.userId, nuvemshopConnection.storeId, { code, type: type === 'percentage' ? 'percentage' : 'absolute', value: val, start_date: new Date().toISOString(), end_date: endsAtIso, max_uses: recipientsCount });
                return code;
            } else if (vtexConnection) {
                await this.vtexService.createCoupon(campaign.userId, vtexConnection.accountName, { couponCode: code, utmSource: 'nucleo-crm', utmCampaign: campaign.id.toString() });
                return code;
            } else if (lojaIntegradaConnection) {
                await this.lojaIntegradaService.createCoupon(campaign.userId, { codigo: code, tipo: type === 'percentage' ? 'porcentagem' : 'fixo', validade: endsAtIso, quantidade: recipientsCount, quantidade_por_cliente: 1 });
                return code;
            }
        } else if (node.type === 'shipping_coupon') {
            const code = node.data?.code || `FRETE_${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

            if (shopifyConnection) {
                await this.shopifyService.createFreeShippingDiscountCode(campaign.userId, shopifyConnection.shop, { title: 'FRETE GRÁTIS', code, endsAt: endsAtIso, minimumSubtotal: node.data?.minPurchaseValue || '0', usageLimit: recipientsCount });
                return code;
            } else if (nuvemshopConnection) {
                await this.nuvemshopService.createCoupon(campaign.userId, nuvemshopConnection.storeId, { code, type: 'shipping', start_date: new Date().toISOString(), end_date: endsAtIso, min_price: node.data?.minPurchaseValue || 0, max_uses: recipientsCount, only_cheapest_shipping: true });
                return code;
            } else if (vtexConnection) {
                await this.vtexService.createCoupon(campaign.userId, vtexConnection.accountName, { couponCode: code, utmSource: 'nucleo-crm', utmCampaign: campaign.id.toString() });
                return code;
            } else if (lojaIntegradaConnection) {
                await this.lojaIntegradaService.createCoupon(campaign.userId, { codigo: code, tipo: 'frete_gratis', validade: endsAtIso, valor_minimo: node.data?.minPurchaseValue || '0', quantidade: recipientsCount, quantidade_por_cliente: 1 });
                return code;
            }
        }
        return null;
    }
}
