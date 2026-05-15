import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, Not, IsNull } from 'typeorm';
import { Sale } from '../entities/sale.entity';
import { Product } from '../entities/product.entity';
import { Campaign } from '../entities/campaign.entity';
import { Contact } from '../entities/contact.entity';
import { PixelEvent } from '../entities/pixel-event.entity';
import { CreateSaleDto } from './dto/create-sale.dto';
import { ImportSaleRow } from './dto/import-sales.dto';
import { ShopifyService } from '../shopify/shopify.service';
import { NuvemshopService } from '../nuvemshop/nuvemshop.service';
import { LojaIntegradaService } from '../loja-integrada/loja-integrada.service';
import { ShopifyConnection } from '../entities/shopify-connection.entity';
import { NuvemshopConnection } from '../entities/nuvemshop-connection.entity';

@Injectable()
export class SalesService {
  private readonly logger = new Logger(SalesService.name);

  constructor(
    @InjectRepository(Sale)
    private saleRepository: Repository<Sale>,
    @InjectRepository(Product)
    private productRepository: Repository<Product>,
    @InjectRepository(Campaign)
    private campaignRepository: Repository<Campaign>,
    @InjectRepository(Contact)
    private contactRepository: Repository<Contact>,
    @InjectRepository(PixelEvent)
    private pixelEventRepository: Repository<PixelEvent>,
    private shopifyService: ShopifyService,
    private nuvemshopService: NuvemshopService,
    private liService: LojaIntegradaService,
  ) { }

  private COMPLETED_STATUSES = ['completed', 'Completo', 'pago', 'Pago', 'aprovado', 'Aprovado', 'success', 'Sucesso'];

  private normalizeStatus(status: string | undefined): string {
    if (!status) return 'completed';
    const s = status.toLowerCase().trim();
    if (['completo', 'pago', 'aprovado', 'finalizado', 'completed', 'paid', 'approved', 'success'].includes(s)) {
      return 'completed';
    }
    if (['cancelado', 'cancelled', 'canceled', 'estornado', 'refunded'].includes(s)) {
      return 'cancelled';
    }
    if (['processando', 'processing', 'pendente', 'pending', 'waiting_payment'].includes(s)) {
      return 'processing';
    }
    return s;
  }

  private parseDate(dateStr: string | undefined): Date {
    if (!dateStr) return new Date();

    // Remove any extra whitespace
    const cleanStr = dateStr.trim();
    if (!cleanStr) return new Date();

    // 1. Handle common Brazilian format FIRST: DD/MM/YYYY or DD-MM-YYYY
    const brDatePattern = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/;
    const match = cleanStr.match(brDatePattern);

    if (match) {
      const day = parseInt(match[1]);
      const month = parseInt(match[2]) - 1; // JS months are 0-11
      let year = parseInt(match[3]);

      if (year < 100) {
        year += 2000; // Assume 21st century for 2-digit years
      }

      const date = new Date(year, month, day);
      if (!isNaN(date.getTime())) return date;
    }

    // 2. Try standard parsing (ISO, etc.)
    let date = new Date(cleanStr);
    if (!isNaN(date.getTime())) return date;

    // Fallback: If it's a number (Unix timestamp or Excel date number)
    if (/^\d+$/.test(cleanStr)) {
      const num = parseInt(cleanStr);
      // Simple heuristic: if > 100000000000, probably ms timestamp, else maybe Excel date or s timestamp
      if (num > 10000000000) {
        date = new Date(num);
      } else if (num > 30000 && num < 60000) {
        // Likely Excel date (number of days since 1900-01-01)
        date = new Date((num - 25569) * 86400 * 1000);
      } else {
        date = new Date(num * 1000);
      }
      if (!isNaN(date.getTime())) return date;
    }

    return new Date();
  }

  async create(userId: number, createSaleDto: CreateSaleDto): Promise<Sale> {
    const { productId, quantity, customerName, customerEmail, status, unitPrice: dtoUnitPrice, totalValue: dtoTotalValue, channel, paymentMethod } = createSaleDto;

    // Buscar produto
    const product = await this.productRepository.findOne({
      where: { id: productId, userId },
    });

    if (!product) {
      throw new NotFoundException('Produto não encontrado');
    }

    if (!product.active) {
      throw new BadRequestException('Produto não está ativo');
    }

    // Allow selling even if out of stock for Pixel events? Or maybe just warn?
    // User requested: "cadastre na tabela de vendas". Usually pixel purchases already happened.
    // So we should record them even if stock is low, maybe update to negative?
    // Let's stick to standard logic but maybe we should allow it.
    // User didn't specify, so I will keep the check for now but it might cause failed tracking if stock is low.
    // Actually, for a Pixel event, the sale happened ON ANOTHER PLATFORM potentially.
    // If I block it here, I lose data.
    // I will comment out the stock check or make it optional?
    // Let's assume for now we enforce stock, if user complains we remove it.
    // Wait, if I am selling via Pixel, it means I am just TRACKING.
    // The stock might not be managed here.
    // But if they are mapping to a Product here, they probably want stock update.

    if (product.stock < quantity) {
      // throw new BadRequestException('Estoque insuficiente'); // Warning: this might block tracking
    }

    // Calcular valores
    const unitPrice = dtoUnitPrice !== undefined ? dtoUnitPrice : product.price;
    const totalValue = dtoTotalValue !== undefined ? dtoTotalValue : unitPrice * quantity;

    // Criar venda
    const sale = this.saleRepository.create({
      productId,
      userId,
      quantity,
      unitPrice,
      totalValue,
      customerName,
      customerEmail,
      channel: channel || 'direct',
      paymentMethod: paymentMethod || undefined,
      status: status || 'completed',
      contactId: createSaleDto.contactId,
    });

    const savedSale = await this.saleRepository.save(sale);

    // Atualizar estoque do produto
    product.stock -= quantity;
    await this.productRepository.save(product);

    return savedSale;
  }

  async findByProduct(productId: number, userId: number): Promise<Sale[]> {
    // Verificar se o produto pertence ao usuário
    const product = await this.productRepository.findOne({
      where: { id: productId, userId },
    });

    if (!product) {
      throw new NotFoundException('Produto não encontrado');
    }

    return this.saleRepository.find({
      where: { productId, userId },
      order: { createdAt: 'DESC' },
    });
  }

  async findAll(userId: number, filters: { onlyWithCampaigns?: boolean } = {}): Promise<Sale[]> {
    const where: any = { userId };
    
    if (filters.onlyWithCampaigns) {
      where.campaignId = Not(IsNull());
    }

    const sales = await this.saleRepository.find({
      where,
      relations: ['product', 'contact', 'campaign'],
      order: { createdAt: 'DESC' },
    });

    // Tentar vincular vendas órfãs com cupom às campanhas
    let updatedAny = false;
    for (const sale of sales) {
      if (sale.couponCode && !sale.campaignId) {
        const campaign = await this.findCampaignByCoupon(userId, sale.couponCode);
        if (campaign) {
          sale.campaignId = campaign.id;
          sale.campaign = campaign;
          await this.saleRepository.save(sale);

          // Atualizar receita da campanha
          campaign.revenue = (Number(campaign.revenue) || 0) + Number(sale.totalValue);
          await this.campaignRepository.save(campaign);
          updatedAny = true;
        }
      }
    }

    return sales;
  }

  private async findCampaignByCoupon(userId: number, couponCode: string): Promise<Campaign | null> {
    // Buscar campanhas do usuário
    const campaigns = await this.campaignRepository.find({
      where: { userId }
    });

    for (const campaign of campaigns) {
      if (!campaign.config) continue;

      // Verificar em campanhas simples
      if (campaign.complexity === 'simple' && campaign.config.campaignConfig?.enableCoupon) {
        if (campaign.config.campaignConfig.coupon?.couponName === couponCode) {
          return campaign;
        }
      }

      // Verificar em campanhas avançadas (nós de cupom ou giftback)
      if (campaign.complexity === 'advanced' && campaign.config.workflow?.nodes) {
        const nodes = campaign.config.workflow.nodes;
        const matchingNode = nodes.find((n: any) =>
          (n.type === 'coupon' || n.type === 'giftback') &&
          n.data?.couponName === couponCode
        );
        if (matchingNode) return campaign;
      }
    }

    return null;
  }

  // Analytics Methods

  private getDateRange(period: number, startIso?: string, endIso?: string) {
    let endDate = new Date();
    let startDate = new Date();
    let prevEndDate = new Date();
    let prevStartDate = new Date();

    if (startIso && endIso) {
      startDate = new Date(startIso);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(endIso);
      endDate.setHours(23, 59, 59, 999);
      
      const diffTime = Math.abs(endDate.getTime() - startDate.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      
      prevEndDate = new Date(startDate);
      prevEndDate.setDate(prevEndDate.getDate() - 1);
      prevEndDate.setHours(23, 59, 59, 999);
      
      prevStartDate = new Date(prevEndDate);
      prevStartDate.setDate(prevStartDate.getDate() - diffDays + 1);
      prevStartDate.setHours(0, 0, 0, 0);
    } else {
      startDate.setDate(endDate.getDate() - period);
      startDate.setHours(0, 0, 0, 0);
      endDate.setHours(23, 59, 59, 999);

      prevEndDate = new Date(startDate);
      prevEndDate.setDate(prevEndDate.getDate() - 1);
      prevEndDate.setHours(23, 59, 59, 999);

      prevStartDate = new Date(prevEndDate);
      prevStartDate.setDate(prevStartDate.getDate() - period + 1);
      prevStartDate.setHours(0, 0, 0, 0);
    }

    return { startDate, endDate, prevStartDate, prevEndDate };
  }

  private standardizePaymentMethod(method: string): string {
    if (!method) return 'Outros';
    const m = method.toLowerCase().trim();
    if (m === 'pix') return 'PIX';
    if (m === 'boleto') return 'Boleto';
    if (m.includes('credito') || m.includes('credit')) return 'Cartão de Crédito';
    if (m.includes('debito') || m.includes('debit')) return 'Cartão de Débito';
    if (m.includes('dinheiro') || m.includes('cash')) return 'Dinheiro';
    return method;
  }

  /**
   * Gatilho para sincronizar integrações em segundo plano
   */
  private async triggerIntegrationsSync(userId: number) {
    try {
      // Sincronizar em paralelo mas em background (sem await no chamador principal)

      // Shopify
      this.shopifyService.getConnections(userId).then(conns => {
        conns.filter(c => c.isActive).forEach(c => {
          this.shopifyService.syncProductsToCrm(userId, c.shop).catch(e => this.logger.error(`[Auto-Sync Shopify Products] ${e.message}`));
          this.shopifyService.syncOrders(userId, c.shop).catch(e => this.logger.error(`[Auto-Sync Shopify Orders] ${e.message}`));
          this.shopifyService.syncCheckouts(userId, c.shop).catch(e => this.logger.error(`[Auto-Sync Shopify Checkouts] ${e.message}`));
        });
      }).catch(e => this.logger.error(`[Auto-Sync Shopify Connections] ${e.message}`));

      // Nuvemshop
      this.nuvemshopService.getConnections(userId).then(conns => {
        conns.filter(c => c.isActive).forEach(c => {
          this.nuvemshopService.syncProductsToCrm(userId, c.storeId).catch(e => this.logger.error(`[Auto-Sync Nuvemshop Products] ${e.message}`));
          this.nuvemshopService.syncOrders(userId, c.storeId).catch(e => this.logger.error(`[Auto-Sync Nuvemshop Orders] ${e.message}`));
          this.nuvemshopService.syncCheckouts(userId, c.storeId).catch(e => this.logger.error(`[Auto-Sync Nuvemshop Checkouts] ${e.message}`));
        });
      }).catch(e => this.logger.error(`[Auto-Sync Nuvemshop Connections] ${e.message}`));

      // Loja Integrada
      this.liService.syncProducts(userId).catch(e => this.logger.error(`[Auto-Sync LI Products] ${e.message}`));
      this.liService.syncOrders(userId).catch(e => this.logger.error(`[Auto-Sync LI Orders] ${e.message}`));
      this.liService.syncCheckouts(userId).catch(e => this.logger.error(`[Auto-Sync LI Checkouts] ${e.message}`));

    } catch (error) {
      this.logger.error(`[Background Sync Error] ${error.message}`);
    }
  }

  async getDashboardStats(userId: number, period: number, filters: { campaignId?: number; productId?: number; startDate?: string; endDate?: string; onlyWithCampaigns?: boolean } = {}) {
    // Disparar sincronização em background
    this.triggerIntegrationsSync(userId);

    const { startDate, endDate, prevStartDate, prevEndDate } = this.getDateRange(period, filters.startDate, filters.endDate);

    const getCurrentStats = async (start: Date, end: Date) => {
      // Sales Stats
      const salesQb = this.saleRepository.createQueryBuilder('sale')
        .select('SUM(sale.totalValue)', 'faturamento')
        .addSelect('COUNT(sale.id)', 'vendas')
        .where('sale.userId = :userId', { userId })
        .andWhere('sale.createdAt BETWEEN :start AND :end', { start, end })
        .andWhere('sale.status IN (:...statuses)', { statuses: this.COMPLETED_STATUSES });

      if (filters.campaignId) {
        salesQb.andWhere('sale.campaignId = :campaignId', { campaignId: filters.campaignId });
      }
      if (filters.onlyWithCampaigns) {
        salesQb.andWhere('sale.campaignId IS NOT NULL');
      }

      const salesResult = await salesQb.getRawOne();

      // Campaign Stats
      const campaignQb = this.campaignRepository.createQueryBuilder('campaign')
        .select('SUM(campaign.sentCount)', 'envios')
        .addSelect('SUM(campaign.deliveredCount)', 'recebidos')
        .addSelect('SUM(campaign.clicksCount)', 'cliques')
        .where('campaign.userId = :userId', { userId })
        .andWhere('campaign.updatedAt BETWEEN :start AND :end', { start, end });

      if (filters.campaignId) {
        campaignQb.andWhere('campaign.id = :campaignId', { campaignId: filters.campaignId });
      }
      // If filtering by product, it's harder to filter campaigns directly unless we link them.
      // For now, if productId is provided, we might want to skip campaign stats or handle them differently.
      // In this CRM, campaigns aren't directly linked to products in the database schema.

      const campaignResult = await campaignQb.getRawOne();

      // Lead/Response events
      const responseQb = this.pixelEventRepository.createQueryBuilder('event')
        .leftJoin('event.pixel', 'pixel')
        .where('pixel.userId = :userId', { userId })
        .andWhere('event.event IN (:...events)', { events: ['Lead', 'Contact', 'SubmitForm'] })
        .andWhere('event.createdAt BETWEEN :start AND :end', { start, end });

      if (filters.campaignId) {
        responseQb.andWhere('event.data->>"$.campaignId" = :campaignId', { campaignId: filters.campaignId.toString() });
      }
      if (filters.productId) {
        responseQb.andWhere('event.data->>"$.productId" = :productId', { productId: filters.productId.toString() });
      }

      const responseCount = await responseQb.getCount();

      const dailySalesQb = this.saleRepository.createQueryBuilder('sale')
        .select('DATE(sale.createdAt)', 'date')
        .addSelect('SUM(sale.totalValue)', 'faturamento')
        .where('sale.userId = :userId', { userId })
        .andWhere('sale.createdAt BETWEEN :start AND :end', { start, end })
        .andWhere('sale.status IN (:...statuses)', { statuses: this.COMPLETED_STATUSES })
        .groupBy('DATE(sale.createdAt)')
        .orderBy('DATE(sale.createdAt)', 'ASC');

      if (filters.campaignId) {
        dailySalesQb.andWhere('sale.campaignId = :campaignId', { campaignId: filters.campaignId });
      }
      if (filters.productId) {
        dailySalesQb.andWhere('sale.productId = :productId', { productId: filters.productId });
      }

      if (filters.onlyWithCampaigns) {
        dailySalesQb.andWhere('sale.campaignId IS NOT NULL');
      }

      const dailySalesResult = await dailySalesQb.getRawMany();
      const dailyRevenue = dailySalesResult.map(item => ({
        date: item.date,
        faturamento: parseFloat(item.faturamento || '0')
      }));

      return {
        faturamento: parseFloat(salesResult.faturamento || '0'),
        vendas: parseInt(salesResult.vendas || '0'),
        envios: parseInt(campaignResult.envios || '0'),
        recebidos: parseInt(campaignResult.recebidos || '0'),
        cliques: parseInt(campaignResult.cliques || '0'),
        respostas: responseCount,
        dailyRevenue
      };
    };

    const current = await getCurrentStats(startDate, endDate);
    const previous = await getCurrentStats(prevStartDate, prevEndDate);

    const calculateTrend = (curr: number, prev: number) => {
      if (!prev || prev === 0) return curr > 0 ? 100 : 0;
      const trend = ((curr - prev) / prev) * 100;
      return isNaN(trend) ? 0 : parseFloat(trend.toFixed(2));
    };

    const ticketMedio = current.vendas > 0 ? current.faturamento / current.vendas : 0;
    const prevTicketMedio = previous.vendas > 0 ? previous.faturamento / previous.vendas : 0;

    const deliveryRate = current.envios > 0 ? Math.min((current.recebidos / current.envios) * 100, 100) : 0;
    const prevDeliveryRate = previous.envios > 0 ? Math.min((previous.recebidos / previous.envios) * 100, 100) : 0;

    // CTR calculation
    const ctr = current.envios > 0 ? Math.min((current.cliques / current.envios) * 100, 100) : 0;

    const responseRate = current.envios > 0 ? Math.min((current.respostas / current.envios) * 100, 100) : 0;
    const prevResponseRate = previous.envios > 0 ? Math.min((previous.respostas / previous.envios) * 100, 100) : 0;

    const [shopifyConns, nuvemshopConns, liConn] = await Promise.all([
      this.shopifyService.getConnections(userId).catch(() => [] as ShopifyConnection[]),
      this.nuvemshopService.getConnections(userId).catch(() => [] as NuvemshopConnection[]),
      this.liService.getActiveConnection(userId).catch(() => null),
    ]);

    const isEcommerceConnected = 
      shopifyConns.some(c => c.isActive) || 
      nuvemshopConns.some(c => c.isActive) || 
      (liConn && liConn.isActive);

    return {
      isEcommerceConnected,
      faturamento: current.faturamento,
      previousFaturamento: previous.faturamento,
      vendas: current.vendas,
      envios: current.envios,
      recebidos: current.recebidos,
      cliques: current.cliques,
      deliveryRate,
      ctr,
      respostas: current.respostas,
      responseRate,
      ticketMedio: ticketMedio,
      trends: {
        faturamento: calculateTrend(current.faturamento, previous.faturamento),
        vendas: calculateTrend(current.vendas, previous.vendas),
        envios: calculateTrend(current.envios, previous.envios),
        recebidos: calculateTrend(current.recebidos, previous.recebidos),
        cliques: calculateTrend(current.cliques, previous.cliques),
        deliveryRate: calculateTrend(deliveryRate, prevDeliveryRate),
        ticketMedio: calculateTrend(ticketMedio, prevTicketMedio),
        respostas: calculateTrend(current.respostas, previous.respostas),
        responseRate: calculateTrend(responseRate, prevResponseRate)
      },
      dailyRevenue: current.dailyRevenue
    };
  }

  async getFunnelStats(userId: number, period: number = 30, filters: { campaignId?: number; productId?: number; startDate?: string; endDate?: string } = {}) {
    const { startDate, endDate } = this.getDateRange(period, filters.startDate, filters.endDate);

    const leadsCountQb = this.contactRepository.createQueryBuilder('contact')
      .where('contact.userId = :userId', { userId });

    if (filters.campaignId || filters.productId) {
      leadsCountQb.innerJoin(PixelEvent, 'event', 'contact.email IS NOT NULL AND (event.data->>"$.email" = contact.email OR event.data->>"$.customer_email" = contact.email)');
      if (filters.campaignId) {
        leadsCountQb.andWhere('event.data->>"$.campaignId" = :campaignId', { campaignId: filters.campaignId.toString() });
      }
      if (filters.productId) {
        leadsCountQb.andWhere('event.data->>"$.productId" = :productId', { productId: filters.productId.toString() });
      }
    }

    const leadsCount = await leadsCountQb.getCount();

    // 2. Engajados: Unique users who visited pages (PageView or ViewContent)
    const engagedQuery = this.pixelEventRepository.createQueryBuilder('event')
      .leftJoin('event.pixel', 'pixel')
      .select('COUNT(DISTINCT event.ip)', 'count') // Using IP as proxy for user if no session/contact
      .where('pixel.userId = :userId', { userId })
      .andWhere('event.event IN (:...events)', { events: ['PageView', 'ViewContent'] })
      .andWhere('event.createdAt BETWEEN :startDate AND :endDate', { startDate, endDate });

    if (filters.campaignId) {
      engagedQuery.andWhere('event.data->>"$.campaignId" = :campaignId', { campaignId: filters.campaignId.toString() });
    }
    if (filters.productId) {
      engagedQuery.andWhere('event.data->>"$.productId" = :productId', { productId: filters.productId.toString() });
    }

    const engagedResult = await engagedQuery.getRawOne();
    const engagedCount = parseInt(engagedResult.count || '0');

    // 3. Carrinho: Unique users who added to cart OR have a synced checkout
    // We use a union approach or distinct contact IDs where possible
    const cartContactsPixel = await this.pixelEventRepository.createQueryBuilder('event')
      .leftJoin('event.pixel', 'pixel')
      .innerJoin(Contact, 'contact', 'contact.email IS NOT NULL AND (event.data->>"$.email" = contact.email OR event.data->>"$.customer_email" = contact.email)')
      .select('DISTINCT contact.id', 'contactId')
      .where('pixel.userId = :userId', { userId })
      .andWhere('event.event = :event', { event: 'AddToCart' })
      .andWhere('event.createdAt BETWEEN :startDate AND :endDate', { startDate, endDate })
      .getRawMany();

    const cartContactsSale = await this.saleRepository.createQueryBuilder('sale')
      .select('DISTINCT COALESCE(CAST(sale.contactId AS CHAR), sale.externalId)', 'id')
      .where('sale.userId = :userId', { userId })
      .andWhere('sale.status IN (:...statuses)', { statuses: ['active_cart', 'abandoned_cart'] })
      .andWhere('sale.createdAt BETWEEN :startDate AND :endDate', { startDate, endDate })
      .getRawMany();

    // Unique IDs from both sources (Pixel Contact IDs and Sale [Contact or External] IDs)
    const allCartIds = new Set([
      ...cartContactsPixel.map(c => c.contactId),
      ...cartContactsSale.map(c => c.id)
    ]);
    const cartCount = allCartIds.size;

    // 4. Compradores: Unique contacts with sales
    const buyersQuery = this.saleRepository.createQueryBuilder('sale')
      .select('COUNT(DISTINCT sale.contactId)', 'count')
      .where('sale.userId = :userId', { userId })
      .andWhere('sale.status IN (:...statuses)', { statuses: this.COMPLETED_STATUSES })
      .andWhere('sale.contactId IS NOT NULL')
      .andWhere('sale.createdAt BETWEEN :startDate AND :endDate', { startDate, endDate });

    if (filters.campaignId) {
      buyersQuery.andWhere('sale.campaignId = :campaignId', { campaignId: filters.campaignId });
    }
    if (filters.productId) {
      buyersQuery.andWhere('sale.productId = :productId', { productId: filters.productId });
    }

    const buyersResult = await buyersQuery.getRawOne();
    const buyersCount = parseInt(buyersResult.count || '0');

    // 5. Fiéis: Contacts with > 1 sales
    const loyalQuery = this.saleRepository.createQueryBuilder('sale')
      .select('sale.contactId')
      .where('sale.userId = :userId', { userId })
      .andWhere('sale.status IN (:...statuses)', { statuses: this.COMPLETED_STATUSES })
      .andWhere('sale.contactId IS NOT NULL')
      .andWhere('sale.createdAt BETWEEN :startDate AND :endDate', { startDate, endDate })
      .groupBy('sale.contactId')
      .having('COUNT(sale.id) > 1');

    if (filters.campaignId) {
      loyalQuery.andWhere('sale.campaignId = :campaignId', { campaignId: filters.campaignId });
    }
    if (filters.productId) {
      loyalQuery.andWhere('sale.productId = :productId', { productId: filters.productId });
    }

    const loyalResult = await loyalQuery.getRawMany();
    const loyalCount = loyalResult.length;

    // Calculate percentages relative to Leads (or previous stage?) - Frontend expects relative to leads usually, or step-by-step
    // Let's return raw counts and let frontend handle visual % if needed, or calculate here.
    // The frontend component expects 'percentage', let's calculate relative to Leads for simplicity or previous step.
    // Actually, usually it's Funnel: Leads (100%) -> Engaged -> Cart -> Purchase -> Loyal

    // Adjust logic: Engaged should probably be higher than Cart. 
    // Ensuring basic consistency:
    const safeLeads = leadsCount || 1;

    return [
      {
        id: 'leads',
        name: 'Leads',
        stage: 'Leads', // Legacy compatibility
        description: 'Novos contatos',
        count: leadsCount,
        value: leadsCount, // Legacy compatibility
        percentage: 100
      },
      {
        id: 'engaged',
        name: 'Engajados',
        stage: 'Engajados',
        description: 'Abriram campanhas/site',
        count: engagedCount,
        value: engagedCount,
        percentage: Math.min(Math.round((engagedCount / safeLeads) * 100), 100)
      },
      {
        id: 'cart',
        name: 'Carrinho',
        stage: 'Carrinho',
        description: 'Adicionaram produtos',
        count: cartCount,
        value: cartCount,
        percentage: Math.min(Math.round((cartCount / safeLeads) * 100), 100)
      },
      {
        id: 'purchase',
        name: 'Compradores',
        stage: 'Compradores',
        description: 'Finalizaram compra',
        count: buyersCount,
        value: buyersCount,
        percentage: Math.min(Math.round((buyersCount / safeLeads) * 100), 100)
      },
      {
        id: 'loyal',
        name: 'Fiéis',
        stage: 'Fiéis',
        description: '2+ compras',
        count: loyalCount,
        value: loyalCount,
        percentage: Math.min(Math.round((loyalCount / safeLeads) * 100), 100)
      }
    ];
  }

  async getSegmentationStats(userId: number, period: number, filters: { campaignId?: number; productId?: number; startDate?: string; endDate?: string } = {}) {
    const { startDate, endDate } = this.getDateRange(period, filters.startDate, filters.endDate);

    // 1. Total Leads (Base) - Filtered if needed
    const baseLeadsQb = this.contactRepository.createQueryBuilder('contact')
      .where('contact.userId = :userId', { userId })
      .andWhere('contact.createdAt BETWEEN :startDate AND :endDate', { startDate, endDate });

    if (filters.campaignId || filters.productId) {
      baseLeadsQb.innerJoin(PixelEvent, 'event', 'contact.email IS NOT NULL AND (event.data->>"$.email" = contact.email OR event.data->>"$.customer_email" = contact.email)');

      if (filters.campaignId) {
        baseLeadsQb.andWhere('event.data->>"$.campaignId" = :campId', { campId: filters.campaignId.toString() });
      }
      if (filters.productId) {
        baseLeadsQb.andWhere('event.data->>"$.productId" = :prodId', { prodId: filters.productId.toString() });
      }
    }

    const totalLeads = await baseLeadsQb.select('COUNT(DISTINCT contact.id)', 'count').getRawOne().then(res => parseInt(res.count || '0'));

    // 2. Total Buyers (Filtered by period)
    const buyersQb = this.saleRepository.createQueryBuilder('sale')
      .select('COUNT(DISTINCT sale.contactId)', 'count')
      .where('sale.userId = :userId', { userId })
      .andWhere('sale.status IN (:...statuses)', { statuses: this.COMPLETED_STATUSES })
      .andWhere('sale.contactId IS NOT NULL')
      .andWhere('sale.createdAt BETWEEN :startDate AND :endDate', { startDate, endDate });

    if (filters.campaignId) buyersQb.andWhere('sale.campaignId = :campaignId', { campaignId: filters.campaignId });
    if (filters.productId) buyersQb.andWhere('sale.productId = :productId', { productId: filters.productId });

    const totalBuyers = parseInt((await buyersQb.getRawOne()).count || '0');

    // 3. Cart Events (Pixel + Synced Checkouts) - Filtered by period
    const cartPixelQb = this.pixelEventRepository.createQueryBuilder('event')
      .leftJoin('event.pixel', 'pixel')
      .innerJoin(Contact, 'contact', 'contact.email IS NOT NULL AND (event.data->>"$.email" = contact.email OR event.data->>"$.customer_email" = contact.email)')
      .select('COUNT(DISTINCT contact.id)', 'count')
      .where('pixel.userId = :userId', { userId })
      .andWhere('event.event = "AddToCart"')
      .andWhere('event.createdAt BETWEEN :startDate AND :endDate', { startDate, endDate });

    if (filters.campaignId) cartPixelQb.andWhere('event.data->>"$.campaignId" = :campId', { campId: filters.campaignId.toString() });
    if (filters.productId) cartPixelQb.andWhere('event.data->>"$.productId" = :prodId', { prodId: filters.productId.toString() });

    const totalCartPixel = parseInt((await cartPixelQb.getRawOne()).count || '0');

    const cartSaleQb = this.saleRepository.createQueryBuilder('sale')
      .select('COUNT(DISTINCT COALESCE(CAST(sale.contactId AS CHAR), sale.externalId))', 'count')
      .where('sale.userId = :userId', { userId })
      .andWhere('sale.status IN (:...statuses)', { statuses: ['active_cart', 'abandoned_cart'] })
      .andWhere('sale.createdAt BETWEEN :startDate AND :endDate', { startDate, endDate });

    if (filters.campaignId) cartSaleQb.andWhere('sale.campaignId = :campaignId', { campaignId: filters.campaignId });
    if (filters.productId) cartSaleQb.andWhere('sale.productId = :productId', { productId: filters.productId });

    const totalCartSale = await cartSaleQb.getRawOne().then(res => parseInt(res.count || '0'));

    const totalCart = totalCartPixel + totalCartSale;

    // 4. Cart Abandonment (Cart without matching Purchase) - Within same period
    const abandonedPixelIds = await this.pixelEventRepository.createQueryBuilder('event')
      .leftJoin('event.pixel', 'pixel')
      .innerJoin(Contact, 'contact', 'contact.email IS NOT NULL AND (event.data->>"$.email" = contact.email OR event.data->>"$.customer_email" = contact.email)')
      .select('DISTINCT contact.id', 'id')
      .where('pixel.userId = :userId', { userId })
      .andWhere('event.event = "AddToCart"')
      .andWhere('event.createdAt BETWEEN :startDate AND :endDate', { startDate, endDate })
      .andWhere((qb) => {
        const subQuery = qb.subQuery()
          .select('sale.contactId')
          .from(Sale, 'sale')
          .where('sale.status IN (:...statuses)', { statuses: this.COMPLETED_STATUSES })
          .andWhere('sale.userId = :userId')
          .getQuery();
        return 'contact.id NOT IN ' + subQuery;
      })
      .getRawMany();

    const abandonedSaleIds = await this.saleRepository.createQueryBuilder('sale')
      .select('DISTINCT COALESCE(CAST(sale.contactId AS CHAR), sale.externalId)', 'id')
      .where('sale.userId = :userId', { userId })
      .andWhere('sale.status IN (:...statuses)', { statuses: ['active_cart', 'abandoned_cart'] })
      .andWhere('sale.createdAt BETWEEN :startDate AND :endDate', { startDate, endDate })
      .getRawMany();

    const allAbandonedContactIds = new Set([
      ...abandonedPixelIds.map(c => c.id),
      ...abandonedSaleIds.map(c => c.id)
    ]);
    const totalCartNoPurchase = allAbandonedContactIds.size;

    // 5. Inactive Clients (No sales in last 90 days) - This definition is typically fixed
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const inactiveQb = this.contactRepository.createQueryBuilder('contact')
      .where('contact.userId = :userId', { userId })
      .andWhere((qb) => {
        const subQuery = qb.subQuery()
          .select('sale.contactId')
          .from(Sale, 'sale')
          .where('sale.userId = :userId')
          .andWhere('sale.status IN (:...statuses)', { statuses: this.COMPLETED_STATUSES })
          .andWhere('sale.createdAt >= :date', { date: ninetyDaysAgo })
          .getQuery();
        return 'contact.id NOT IN ' + subQuery;
      });

    const inactiveCount = await inactiveQb.getCount();

    // 6. Loyalty (2+ Sales) - Filtered by period
    const loyalQb = this.contactRepository.createQueryBuilder('contact')
      .select('contact.id')
      .innerJoin(Sale, 'sale', 'sale.contactId = contact.id AND sale.status IN (:...statuses) AND sale.userId = :userId', { userId, statuses: this.COMPLETED_STATUSES })
      .where('sale.createdAt BETWEEN :startDate AND :endDate', { startDate, endDate })
      .groupBy('contact.id')
      .having('COUNT(sale.id) > 1');

    if (filters.campaignId) loyalQb.andWhere('sale.campaignId = :campaignId', { campaignId: filters.campaignId });
    if (filters.productId) loyalQb.andWhere('sale.productId = :productId', { productId: filters.productId });

    const loyalCount = (await loyalQb.getRawMany()).length;

    const conversionRate = totalLeads > 0 ? Math.min((totalBuyers / totalLeads) * 100, 100) : 0;
    const loyaltyRate = totalBuyers > 0 ? Math.min((loyalCount / totalBuyers) * 100, 100) : 0;
    const abandonmentRate = totalCart > 0 ? Math.min((totalCartNoPurchase / totalCart) * 100, 100) : 0;

    const safeRound = (val: number) => isNaN(val) ? 0 : Math.round(val);

    return {
      conversionRate: safeRound(conversionRate),
      loyaltyRate: safeRound(loyaltyRate),
      cartAbandonmentRate: safeRound(abandonmentRate),
      abandonedCart: totalCartNoPurchase,
      recentBuyers: totalBuyers,
      inactive: inactiveCount
    };
  }

  async getSalesByCampaign(userId: number, period: number, filters: { productId?: number; startDate?: string; endDate?: string } = {}) {
    const { startDate, endDate } = this.getDateRange(period, filters.startDate, filters.endDate);

    const qb = this.saleRepository.createQueryBuilder('sale')
      .leftJoin('sale.campaign', 'campaign')
      .select('campaign.name', 'nome')
      .addSelect(`
        CASE 
          WHEN LOWER(campaign.channel) = 'whatsapp' THEN 'WhatsApp'
          WHEN LOWER(campaign.channel) = 'sms' THEN 'SMS'
          WHEN LOWER(campaign.channel) = 'email' THEN 'E-mail'
          WHEN LOWER(campaign.channel) = 'manual' OR LOWER(sale.channel) = 'manual' THEN 'Venda Manual'
          ELSE 'Outros' 
        END
      `, 'canal')
      .addSelect('SUM(sale.totalValue)', 'faturamento')
      .addSelect('COUNT(sale.id)', 'vendas')
      .where('sale.userId = :userId', { userId })
      .andWhere('sale.createdAt BETWEEN :startDate AND :endDate', { startDate, endDate })
      .andWhere('sale.status IN (:...statuses)', { statuses: this.COMPLETED_STATUSES })
      .andWhere('sale.campaignId IS NOT NULL');

    if (filters.productId) {
      qb.andWhere('sale.productId = :productId', { productId: filters.productId });
    }

    const result = await qb.groupBy('campaign.name')
      .addGroupBy('canal')
      .getRawMany();

    return result.map(item => ({
      nome: item.nome || 'Campanha Desconhecida',
      canal: item.canal,
      faturamento: parseFloat(item.faturamento),
      vendas: parseInt(item.vendas)
    }));
  }

  async getSalesByChannel(userId: number, period: number, filters: { campaignId?: number; productId?: number; startDate?: string; endDate?: string; onlyWithCampaigns?: boolean } = {}) {
    const { startDate, endDate } = this.getDateRange(period, filters.startDate, filters.endDate);

    const qb = this.saleRepository.createQueryBuilder('sale')
      .leftJoin('sale.campaign', 'campaign')
      .select(`
        CASE 
          WHEN LOWER(campaign.channel) = 'whatsapp' THEN 'WhatsApp'
          WHEN LOWER(campaign.channel) = 'sms' THEN 'SMS'
          WHEN LOWER(campaign.channel) = 'email' THEN 'E-mail'
          WHEN LOWER(campaign.channel) = 'manual' OR LOWER(sale.channel) = 'manual' THEN 'Venda Manual'
          ELSE 'Outros' 
        END
      `, 'canal')
      .addSelect('SUM(sale.totalValue)', 'faturamento')
      .addSelect('COUNT(sale.id)', 'vendas')
      .where('sale.userId = :userId', { userId })
      .andWhere('sale.createdAt BETWEEN :startDate AND :endDate', { startDate, endDate })
      .andWhere('sale.status IN (:...statuses)', { statuses: this.COMPLETED_STATUSES });

    if (filters.campaignId) qb.andWhere('sale.campaignId = :campaignId', { campaignId: filters.campaignId });
    if (filters.productId) qb.andWhere('sale.productId = :productId', { productId: filters.productId });
    if (filters.onlyWithCampaigns) qb.andWhere('sale.campaignId IS NOT NULL');

    const result = await qb.groupBy('canal')
      .getRawMany();

    return result.map(item => ({
      canal: item.canal,
      faturamento: parseFloat(item.faturamento),
      vendas: parseInt(item.vendas)
    }));
  }

  async getTopProducts(userId: number, period: number, filters: { campaignId?: number; startDate?: string; endDate?: string; onlyWithCampaigns?: boolean } = {}) {
    const { startDate, endDate } = this.getDateRange(period, filters.startDate, filters.endDate);

    const qb = this.saleRepository.createQueryBuilder('sale')
      .leftJoin('sale.product', 'product')
      .select('product.name', 'nome')
      .addSelect('SUM(sale.quantity)', 'vendas') // Sum quantity not just count rows
      .addSelect('SUM(sale.totalValue)', 'faturamento')
      .where('sale.userId = :userId', { userId })
      .andWhere('sale.createdAt BETWEEN :startDate AND :endDate', { startDate, endDate })
      .andWhere('sale.status IN (:...statuses)', { statuses: this.COMPLETED_STATUSES });

    if (filters.campaignId) qb.andWhere('sale.campaignId = :campaignId', { campaignId: filters.campaignId });
    if (filters.onlyWithCampaigns) qb.andWhere('sale.campaignId IS NOT NULL');

    const result = await qb.groupBy('product.name')
      .orderBy('faturamento', 'DESC')
      .limit(5)
      .getRawMany();

    return result.map(item => ({
      nome: item.nome,
      vendas: parseInt(item.vendas),
      faturamento: parseFloat(item.faturamento)
    }));
  }

  async getPaymentMethods(userId: number, period: number, filters: { campaignId?: number; productId?: number; startDate?: string; endDate?: string; onlyWithCampaigns?: boolean } = {}) {
    const { startDate, endDate } = this.getDateRange(period, filters.startDate, filters.endDate);

    // Use query builder for total count within period
    const totalCountQb = this.saleRepository.createQueryBuilder('sale')
      .select('COUNT(sale.id)', 'total')
      .addSelect('SUM(sale.totalValue)', 'totalFaturamento')
      .where('sale.userId = :userId', { userId })
      .andWhere('sale.createdAt BETWEEN :startDate AND :endDate', { startDate, endDate })
      .andWhere('sale.status IN (:...statuses)', { statuses: this.COMPLETED_STATUSES });

    if (filters.campaignId) totalCountQb.andWhere('sale.campaignId = :campaignId', { campaignId: filters.campaignId });
    if (filters.productId) totalCountQb.andWhere('sale.productId = :productId', { productId: filters.productId });
    if (filters.onlyWithCampaigns) totalCountQb.andWhere('sale.campaignId IS NOT NULL');

    const totalResult = await totalCountQb.getRawOne();
    const total = parseInt(totalResult.total || '0');
    const totalFaturamento = parseFloat(totalResult.totalFaturamento || '0');

    const qb = this.saleRepository.createQueryBuilder('sale')
      .select('sale.paymentMethod', 'metodo')
      .addSelect('COUNT(sale.id)', 'transacoes')
      .addSelect('SUM(sale.totalValue)', 'faturamento')
      .where('sale.userId = :userId', { userId })
      .andWhere('sale.createdAt BETWEEN :startDate AND :endDate', { startDate, endDate })
      .andWhere('sale.status IN (:...statuses)', { statuses: this.COMPLETED_STATUSES });

    if (filters.campaignId) qb.andWhere('sale.campaignId = :campaignId', { campaignId: filters.campaignId });
    if (filters.productId) qb.andWhere('sale.productId = :productId', { productId: filters.productId });

    const result = await qb.groupBy('sale.paymentMethod')
      .getRawMany();

    return result.map(item => {
      const faturamento = parseFloat(item.faturamento || '0');
      return {
        metodo: this.standardizePaymentMethod(item.metodo),
        transacoes: parseInt(item.transacoes),
        faturamento,
        percentual: totalFaturamento > 0 ? (faturamento / totalFaturamento) * 100 : 0,
        tempoMedio: 'N/A' // Not tracking payment time yet
      };
    });
  }

  // Mock for Funnel (since we don't have full tracking of Leads -> Access -> Cart -> Sale yet)
  async getFunnelData(userId: number, period: number) {
    const { startDate, endDate } = this.getDateRange(period);

    // 1. Leads: Count contacts created in period
    const leadsCount = await this.contactRepository.count({
      where: {
        userId,
        createdAt: Between(startDate, endDate),
      }
    });

    // 2. Opens & Clicks: Aggregated from campaigns sent in period
    // We filter campaigns updated (or created) in this period to approximate activity
    // Ideally we would have a 'CampaignEvent' table, but using Campaign aggregates is a good approximation
    const campaignStats = await this.campaignRepository.createQueryBuilder('campaign')
      .select('SUM(campaign.deliveredCount)', 'opens')
      .addSelect('SUM(campaign.clicksCount)', 'clicks')
      .where('campaign.userId = :userId', { userId })
      .andWhere('campaign.updatedAt BETWEEN :startDate AND :endDate', { startDate, endDate })
      .getRawOne();

    const opensCount = parseInt(campaignStats.opens || '0');
    const clicksCount = parseInt(campaignStats.clicks || '0');

    // 3. Sales: Actual sales count
    const salesCount = await this.saleRepository.createQueryBuilder('sale')
      .where('sale.userId = :userId', { userId })
      .andWhere('sale.createdAt BETWEEN :startDate AND :endDate', { startDate, endDate })
      .andWhere('sale.status IN (:...statuses)', { statuses: this.COMPLETED_STATUSES })
      .getCount();

    // 4. Carts: Placeholder (0) as we don't track cart events yet
    const cartsCount = 0;

    // Calculate percentages relative to the previous stage
    // Leads -> Opens -> Clicks -> Add to Cart -> Purchase
    // Note: This linear funnel is an approximation. 
    // "Leads" (Total Contacts) might not be the direct source of "Opens" (Campaign Recipients), 
    // but it's the top of the funnel in this CRM context.

    // Base for percentage calculation (Leads)
    const base = leadsCount > 0 ? leadsCount : 1; // Avoid division by zero

    return [
      {
        stage: 'Leads Gerados',
        value: leadsCount,
        percentage: 100
      },
      {
        stage: 'Abriram Campanha',
        value: opensCount,
        percentage: (opensCount / base) * 100
      },
      {
        stage: 'Clicaram Link',
        value: clicksCount,
        percentage: (clicksCount / base) * 100
      },
      {
        stage: 'Adicionaram Carrinho',
        value: cartsCount,
        percentage: (cartsCount / base) * 100
      },
      {
        stage: 'Finalizaram Compra',
        value: salesCount,
        percentage: (salesCount / base) * 100
      }
    ];
  }

  async getDashboardHeatmap(userId: number, period: number, filters: { campaignId?: number; productId?: number; startDate?: string; endDate?: string }) {
    const { startDate, endDate } = this.getDateRange(period, filters.startDate, filters.endDate);
    // Disparar sincronização em background
    this.triggerIntegrationsSync(userId);

    const rawQb = this.contactRepository.createQueryBuilder('contact')
      .select([
        'contact.id AS id',
        'contact.createdAt AS createdAt',
        'contact.updatedAt AS updatedAt',
        'MAX(COALESCE(sale.createdAt, contact.updatedAt, event.createdAt)) AS lastActivityAt',
        'COUNT(DISTINCT CASE WHEN sale.status IN (:...statuses) AND sale.createdAt BETWEEN :startDate AND :endDate THEN sale.id END) AS saleCount',
        'COUNT(DISTINCT CASE WHEN event.event IN ("PageView", "ViewContent") AND event.createdAt BETWEEN :startDate AND :endDate THEN event.id END) AS engagementCount',
        'COUNT(DISTINCT CASE WHEN (event.event = "AddToCart" AND event.createdAt BETWEEN :startDate AND :endDate) OR (sale.status = "active_cart" AND sale.createdAt BETWEEN :startDate AND :endDate) THEN COALESCE(event.id, sale.id) END) AS cartCount',
        'COUNT(DISTINCT CASE WHEN sale.status = "abandoned_cart" AND sale.createdAt BETWEEN :startDate AND :endDate THEN sale.id END) AS abandonedCount'
      ])
      .leftJoin(Sale, 'sale', 'sale.contactId = contact.id')
      .leftJoin(PixelEvent, 'event', 'contact.email IS NOT NULL AND (event.data->>"$.email" = contact.email OR event.data->>"$.customer_email" = contact.email)')
      .where('contact.userId = :userId', { userId })
      .setParameters({ startDate, endDate, statuses: this.COMPLETED_STATUSES })
      .groupBy('contact.id');

    if (filters.campaignId) {
      rawQb.andWhere('(sale.campaignId = :campaignId OR event.data->>"$.campaignId" = :campaignIdString)', {
        campaignId: filters.campaignId,
        campaignIdString: filters.campaignId.toString()
      });
    }

    if (filters.productId) {
      rawQb.andWhere('(sale.productId = :productId OR event.data->>"$.productId" = :productIdString)', {
        productId: filters.productId,
        productIdString: filters.productId.toString()
      });
    }

    const contactsQb = rawQb.getRawMany();

    const contacts = (await contactsQb).map(c => ({
      ...c,
      isAnonymous: false
    }));

    // Buscar carrinhos anônimos (sem contato vinculado)
    const anonymousQb = this.saleRepository.createQueryBuilder('sale')
      .select([
        'sale.externalId AS id',
        'MAX(sale.createdAt) AS createdAt',
        'MAX(sale.createdAt) AS updatedAt',
        'MAX(sale.createdAt) AS lastActivityAt',
        '0 AS saleCount',
        '0 AS engagementCount',
        'COUNT(DISTINCT CASE WHEN sale.status = "active_cart" THEN sale.id END) AS cartCount',
        'COUNT(DISTINCT CASE WHEN sale.status = "abandoned_cart" THEN sale.id END) AS abandonedCount',
        'TRUE AS isAnonymous'
      ])
      .where('sale.userId = :userId', { userId })
      .andWhere('sale.contactId IS NULL')
      .andWhere('sale.status IN ("active_cart", "abandoned_cart")')
      .andWhere('sale.createdAt BETWEEN :startDate AND :endDate', { startDate, endDate });

    if (filters.campaignId) anonymousQb.andWhere('sale.campaignId = :campaignId', { campaignId: filters.campaignId });
    if (filters.productId) anonymousQb.andWhere('sale.productId = :productId', { productId: filters.productId });

    const anonymousSales = await anonymousQb.groupBy('sale.externalId').getRawMany();

    const allEntities = [...contacts, ...anonymousSales];

    // Reference dates for segments relative to end of period (or now)
    const referenceDate = endDate || new Date();
    const ago7d = new Date(referenceDate.getTime() - 7 * 24 * 60 * 60 * 1000);
    const ago30d = new Date(referenceDate.getTime() - 30 * 24 * 60 * 60 * 1000);
    const ago60d = new Date(referenceDate.getTime() - 60 * 24 * 60 * 60 * 1000);

    const segments = [
      { name: 'Novos Leads', filter: (c) => new Date(c.createdAt) >= ago7d && parseInt(c.saleCount || '0') == 0 },
      { name: 'Engajados', filter: (c) => parseInt(c.engagementCount || '0') > 0 && parseInt(c.saleCount || '0') == 0 && new Date(c.lastActivityAt) >= ago30d },
      { name: 'Carrinho Ativo', filter: (c) => parseInt(c.cartCount || '0') > 0 && new Date(c.lastActivityAt) >= ago7d },
      { name: 'Carrinho Abandonado', filter: (c) => parseInt(c.abandonedCount || '0') > 0 },
      { name: 'Compradores', filter: (c) => parseInt(c.saleCount || '0') == 1 },
      { name: 'Clientes Fiéis', filter: (c) => parseInt(c.saleCount || '0') > 1 },
      { name: 'Inativos 30d', filter: (c) => new Date(c.lastActivityAt) < ago30d && new Date(c.lastActivityAt) >= ago60d },
      { name: 'Inativos 60d', filter: (c) => new Date(c.lastActivityAt) < ago60d },
      { name: 'Recuperados', filter: (c) => parseInt(c.saleCount || '0') > 0 && new Date(c.lastActivityAt) >= ago7d && new Date(c.createdAt) < ago30d }
    ];

    return segments.map(seg => {
      const segContacts = allEntities.filter(seg.filter);
      return {
        name: seg.name,
        leads: segContacts.filter(c => !c.isAnonymous).length, // Apenas contatos registrados são leads
        engaged: segContacts.filter(c => parseInt(c.engagementCount || '0') > 0).length,
        cart: segContacts.filter(c => parseInt(c.cartCount || '0') > 0).length,
        abandoned: segContacts.filter(c => parseInt(c.abandonedCount || '0') > 0).length,
        purchase: segContacts.filter(c => parseInt(c.saleCount || '0') > 0).length,
        loyal: segContacts.filter(c => parseInt(c.saleCount || '0') > 1).length
      };
    });
  }

  async importFromCSV(userId: number, rows: ImportSaleRow[]): Promise<{ created: number; errors: string[] }> {
    const errors: string[] = [];
    let created = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const lineNumber = i + 2;

      try {
        // 1. Buscar ou Vincular Contato (Opcional)
        let contact: Contact | null = null;
        
        if (row.email && row.email.trim()) {
          contact = await this.contactRepository.findOne({
            where: { email: row.email, userId },
          });

          if (!contact) {
            contact = this.contactRepository.create({
              email: row.email,
              name: row.customerName || row.email.split('@')[0],
              userId,
              status: 'lead',
            });
            contact = await this.contactRepository.save(contact);
          }
        }

        // 2. Buscar Produto
        let product: Product | null = null;
        if (row.sku) {
          product = await this.productRepository.findOne({
            where: { sku: row.sku, userId },
          });
        }

        if (!product && row.productName) {
          product = await this.productRepository.findOne({
            where: { name: row.productName, userId },
          });
        }

        if (!product) {
          errors.push(`Linha ${lineNumber}: Produto "${row.productName || row.sku}" não encontrado`);
          continue;
        }

        // 3. Processar Valores
        const quantity = typeof row.quantity === 'string' ? parseFloat(row.quantity) : row.quantity || 1;
        const totalValue = typeof row.totalValue === 'string' ? parseFloat(row.totalValue.replace('R$', '').replace(',', '.')) : row.totalValue || 0;
        const unitPrice = row.unitPrice ? (typeof row.unitPrice === 'string' ? parseFloat(row.unitPrice.replace('R$', '').replace(',', '.')) : row.unitPrice) : (totalValue / quantity);

        // 4. Criar Venda
        const sale = this.saleRepository.create({
          userId,
          contactId: contact ? contact.id : undefined,
          productId: product.id,
          quantity,
          unitPrice,
          totalValue,
          customerName: contact ? contact.name : (row.customerName || 'Consumidor'),
          customerEmail: contact ? contact.email : (row.email || undefined),
          channel: row.channel || 'import',
          status: this.normalizeStatus(row.status),
          paymentMethod: row.paymentMethod || 'other',
          createdAt: this.parseDate(row.date),
        });

        await this.saleRepository.save(sale);

        // 5. Atualizar Estoque
        product.stock -= quantity;
        await this.productRepository.save(product);

        created++;
      } catch (error) {
        errors.push(`Linha ${lineNumber}: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
      }
    }

    return { created, errors };
  }
}

