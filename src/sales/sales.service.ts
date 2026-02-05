import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { Sale } from '../entities/sale.entity';
import { Product } from '../entities/product.entity';
import { Campaign } from '../entities/campaign.entity';
import { Contact } from '../entities/contact.entity';
import { CreateSaleDto } from './dto/create-sale.dto';

@Injectable()
export class SalesService {
  constructor(
    @InjectRepository(Sale)
    private saleRepository: Repository<Sale>,
    @InjectRepository(Product)
    private productRepository: Repository<Product>,
    @InjectRepository(Campaign)
    private campaignRepository: Repository<Campaign>,
    @InjectRepository(Contact)
    private contactRepository: Repository<Contact>,
  ) { }

  async create(userId: number, createSaleDto: CreateSaleDto): Promise<Sale> {
    const { productId, quantity, customerName, customerEmail, status } = createSaleDto;

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

    if (product.stock < quantity) {
      throw new BadRequestException('Estoque insuficiente');
    }

    // Calcular valores
    const unitPrice = product.price;
    const totalValue = unitPrice * quantity;

    // Criar venda
    const sale = this.saleRepository.create({
      productId,
      userId,
      quantity,
      unitPrice,
      totalValue,
      customerName,
      customerEmail,
      status: status || 'completed',
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

  async findAll(userId: number): Promise<Sale[]> {
    return this.saleRepository.find({
      where: { userId },
      relations: ['product'],
      order: { createdAt: 'DESC' },
    });
  }

  // Analytics Methods

  private getDateRange(period: number) {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - period);

    // Previous period for trends
    const prevEndDate = new Date(startDate);
    const prevStartDate = new Date(startDate);
    prevStartDate.setDate(prevEndDate.getDate() - period);

    return { startDate, endDate, prevStartDate, prevEndDate };
  }

  async getDashboardStats(userId: number, period: number) {
    const { startDate, endDate, prevStartDate, prevEndDate } = this.getDateRange(period);

    const getCurrentStats = async (start: Date, end: Date) => {
      const qb = this.saleRepository.createQueryBuilder('sale')
        .select('SUM(sale.totalValue)', 'faturamento')
        .addSelect('COUNT(sale.id)', 'vendas')
        .where('sale.userId = :userId', { userId })
        .andWhere('sale.createdAt BETWEEN :start AND :end', { start, end })
        .andWhere('sale.status = :status', { status: 'completed' }); // Assuming only completed sales count

      const result = await qb.getRawOne();
      return {
        faturamento: parseFloat(result.faturamento || '0'),
        vendas: parseInt(result.vendas || '0'),
      };
    };

    const current = await getCurrentStats(startDate, endDate);
    const previous = await getCurrentStats(prevStartDate, prevEndDate);

    const calculateTrend = (curr: number, prev: number) => {
      if (prev === 0) return 100;
      return ((curr - prev) / prev) * 100;
    };

    const ticketMedio = current.vendas > 0 ? current.faturamento / current.vendas : 0;
    const prevTicketMedio = previous.vendas > 0 ? previous.faturamento / previous.vendas : 0;

    return {
      faturamento: current.faturamento,
      vendas: current.vendas,
      ticketMedio: ticketMedio,
      trends: {
        faturamento: calculateTrend(current.faturamento, previous.faturamento),
        vendas: calculateTrend(current.vendas, previous.vendas),
        ticketMedio: calculateTrend(ticketMedio, prevTicketMedio)
      }
    };
  }

  async getSalesByCampaign(userId: number, period: number) {
    const { startDate, endDate } = this.getDateRange(period);

    const result = await this.saleRepository.createQueryBuilder('sale')
      .leftJoin('sale.campaign', 'campaign')
      .select('campaign.name', 'nome')
      .addSelect('sale.channel', 'canal')
      .addSelect('SUM(sale.totalValue)', 'faturamento')
      .addSelect('COUNT(sale.id)', 'vendas')
      .where('sale.userId = :userId', { userId })
      .andWhere('sale.createdAt BETWEEN :startDate AND :endDate', { startDate, endDate })
      .andWhere('sale.campaignId IS NOT NULL')
      .groupBy('campaign.name')
      .addGroupBy('sale.channel')
      .getRawMany();

    return result.map(item => ({
      nome: item.nome || 'Campanha Desconhecida',
      canal: item.canal || 'Outros',
      faturamento: parseFloat(item.faturamento),
      vendas: parseInt(item.vendas)
    }));
  }

  async getSalesByChannel(userId: number, period: number) {
    const { startDate, endDate } = this.getDateRange(period);

    const result = await this.saleRepository.createQueryBuilder('sale')
      .select('sale.channel', 'canal')
      .addSelect('SUM(sale.totalValue)', 'faturamento')
      .addSelect('COUNT(sale.id)', 'vendas')
      .where('sale.userId = :userId', { userId })
      .andWhere('sale.createdAt BETWEEN :startDate AND :endDate', { startDate, endDate })
      .groupBy('sale.channel')
      .getRawMany();

    return result.map(item => ({
      canal: item.canal || 'Direto',
      faturamento: parseFloat(item.faturamento),
      vendas: parseInt(item.vendas)
    }));
  }

  async getTopProducts(userId: number, period: number) {
    const { startDate, endDate } = this.getDateRange(period);

    const result = await this.saleRepository.createQueryBuilder('sale')
      .leftJoin('sale.product', 'product')
      .select('product.name', 'nome')
      .addSelect('SUM(sale.quantity)', 'vendas') // Sum quantity not just count rows
      .addSelect('SUM(sale.totalValue)', 'faturamento')
      .where('sale.userId = :userId', { userId })
      .andWhere('sale.createdAt BETWEEN :startDate AND :endDate', { startDate, endDate })
      .groupBy('product.name')
      .orderBy('faturamento', 'DESC')
      .limit(5)
      .getRawMany();

    return result.map(item => ({
      nome: item.nome,
      vendas: parseInt(item.vendas),
      faturamento: parseFloat(item.faturamento)
    }));
  }

  async getPaymentMethods(userId: number, period: number) {
    const { startDate, endDate } = this.getDateRange(period);

    const totalSales = await this.saleRepository.count({
      where: {
        userId,
        // createdAt logic needs to be in query builder or FindOptions 
      }
      // Simplified total count for percentage calculation
    });

    // Use query builder for total count within period
    const totalResult = await this.saleRepository.createQueryBuilder('sale')
      .select('COUNT(sale.id)', 'total')
      .where('sale.userId = :userId', { userId })
      .andWhere('sale.createdAt BETWEEN :startDate AND :endDate', { startDate, endDate })
      .getRawOne();

    const total = parseInt(totalResult.total || '0');

    const result = await this.saleRepository.createQueryBuilder('sale')
      .select('sale.paymentMethod', 'metodo')
      .addSelect('COUNT(sale.id)', 'transacoes')
      .where('sale.userId = :userId', { userId })
      .andWhere('sale.createdAt BETWEEN :startDate AND :endDate', { startDate, endDate })
      .groupBy('sale.paymentMethod')
      .getRawMany();

    return result.map(item => ({
      metodo: item.metodo || 'Outros',
      transacoes: parseInt(item.transacoes),
      percentual: total > 0 ? (parseInt(item.transacoes) / total) * 100 : 0,
      tempoMedio: 'N/A' // Not tracking payment time yet
    }));
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
      .select('SUM(campaign.opensCount)', 'opens')
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
}

