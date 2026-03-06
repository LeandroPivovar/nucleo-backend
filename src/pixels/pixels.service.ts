import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Pixel } from '../entities/pixel.entity';
import { PixelEvent } from '../entities/pixel-event.entity';
import { CreatePixelDto } from './dto/create-pixel.dto';
import { TrackEventDto } from './dto/track-event.dto';
import { randomUUID } from 'crypto';

import { Product } from '../entities/product.entity';
import { SalesService } from '../sales/sales.service';
import { ContactsService } from '../contacts/contacts.service';

@Injectable()
export class PixelsService {
    constructor(
        @InjectRepository(Pixel)
        private pixelsRepository: Repository<Pixel>,
        @InjectRepository(PixelEvent)
        private eventsRepository: Repository<PixelEvent>,
        @InjectRepository(Product)
        private productsRepository: Repository<Product>,
        private salesService: SalesService,
        private contactsService: ContactsService,
    ) { }

    async createPixel(createPixelDto: CreatePixelDto, userId: number): Promise<Pixel> {
        const pixel = this.pixelsRepository.create({
            ...createPixelDto,
            userId,
            pixelId: randomUUID(),
        });
        return this.pixelsRepository.save(pixel);
    }

    async findAll(userId: number): Promise<Pixel[]> {
        const pixels = await this.pixelsRepository.find({
            where: { userId },
            order: { createdAt: 'DESC' },
        });

        // Carregar contagens para cada pixel
        // Nota: Em produção com muitos dados, isso deve ser otimizado com subqueries ou denormalização
        for (const pixel of pixels) {
            const eventsCount = await this.eventsRepository.count({
                where: { pixelId: pixel.pixelId }
            });

            const conversionsCount = await this.eventsRepository.count({
                where: [
                    { pixelId: pixel.pixelId, event: 'Purchase' },
                    { pixelId: pixel.pixelId, event: 'Lead' }
                ]
            });

            (pixel as any).eventsCount = eventsCount;
            (pixel as any).conversionsCount = conversionsCount;
        }

        return pixels;
    }

    async findOne(pixelId: string): Promise<Pixel> {
        const pixel = await this.pixelsRepository.findOne({ where: { pixelId } });
        if (!pixel) {
            throw new NotFoundException(`Pixel with ID ${pixelId} not found`);
        }
        return pixel;
    }

    async trackEvent(trackEventDto: TrackEventDto, ip: string): Promise<void> {
        // Verificar se o pixel existe (opcional, mas bom para integridade)
        const pixel = await this.pixelsRepository.findOne({
            where: { pixelId: trackEventDto.pixel_id },
        });

        if (!pixel) {
            return; // Silently ignore events for non-existent pixels or log it
        }

        const event = this.eventsRepository.create({
            pixelId: trackEventDto.pixel_id,
            event: trackEventDto.event,
            data: trackEventDto.data,
            url: trackEventDto.url,
            userAgent: trackEventDto.user_agent,
            sessionId: trackEventDto.session_id,
            pageTitle: trackEventDto.page_title,
            timestamp: (trackEventDto.timestamp || Date.now()).toString(),
            sku: trackEventDto.sku || trackEventDto.content_id || trackEventDto.data?.sku || trackEventDto.data?.content_id, // Busca SKU no nível raiz ou dentro de 'data'
            pixel: pixel,
            ip: this.anonimizeIp(ip),
        });

        const savedEvent = await this.eventsRepository.save(event);

        // Auto-create Sale if Purchase
        if (event.event === 'Purchase' && pixel.userId) {
            try {
                const data = event.data || {};
                const items: { sku: string, quantity: number }[] = [];

                if (Array.isArray(data.items)) {
                    data.items.forEach((i: any) => {
                        if (i.sku || i.id) items.push({ sku: i.sku || i.id, quantity: Number(i.quantity) || 1 });
                    });
                } else if (Array.isArray(data.contents)) {
                    data.contents.forEach((i: any) => {
                        if (i.id) items.push({ sku: i.id, quantity: Number(i.quantity) || 1 });
                    });
                } else {
                    const tokens: string[] = [];
                    if (event.sku) tokens.push(event.sku);
                    else if (data.sku) tokens.push(data.sku);
                    else if (data.content_id) tokens.push(data.content_id);
                    else if (Array.isArray(data.skus)) tokens.push(...data.skus);

                    const uniqueTokens = [...new Set(tokens.filter(t => t))];
                    uniqueTokens.forEach(t => items.push({ sku: t, quantity: 1 }));
                }

                if (items.length > 0) {
                    // Calculate unit values if multiple items
                    const totalEventValue = parseFloat(data.value || 0);
                    const totalQuantity = items.reduce((acc, i) => acc + i.quantity, 0) || 1;
                    const calculatedUnitValue = totalEventValue / totalQuantity;

                    // Handle Contact Creation/Lookup
                    let contactId: number | undefined;
                    const email = data.customer_email || data.email;

                    if (email) {
                        const existingContact = await this.contactsService.findByEmail(pixel.userId, email);
                        if (existingContact) {
                            contactId = existingContact.id;
                        } else {
                            // Create new contact
                            const nameWithLast = (data.customer_name || data.payer_name || data.name || 'Cliente Pixel').trim();
                            const nameParts = nameWithLast.split(' ');
                            const firstName = nameParts[0];
                            const lastName = nameParts.slice(1).join(' ') || undefined;

                            try {
                                const newContact = await this.contactsService.create(pixel.userId, {
                                    name: firstName,
                                    lastName,
                                    email,
                                    phone: data.customer_phone || data.phone,
                                    city: data.customer_city || data.city,
                                    state: data.customer_state || data.state,
                                    notes: data.customer_address ? `Endereço: ${data.customer_address}` : undefined,
                                    source: 'pixel',
                                    status: 'lead'
                                });
                                contactId = newContact.id;
                            } catch (e) {
                                console.error('Error creating contact from pixel:', e);
                            }
                        }
                    }

                    for (const item of items) {
                        const product = await this.productsRepository.findOne({ where: { sku: item.sku, userId: pixel.userId } });
                        if (product) {
                            await this.salesService.create(pixel.userId, {
                                productId: product.id,
                                quantity: item.quantity,
                                customerName: data.customer_name || data.payer_name,
                                customerEmail: data.customer_email || data.email,
                                status: 'completed',
                                channel: 'pixel',
                                unitPrice: calculatedUnitValue,
                                totalValue: calculatedUnitValue * item.quantity,
                                contactId, // Associate with contact
                            });
                        }
                    }
                }
            } catch (error) {
                console.error('Error auto-creating sale from pixel:', error);
                // Don't fail the request, just log
            }
        }
    }

    async getMetrics(userId: number, period = 30) {
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(endDate.getDate() - period);

        const previousEndDate = new Date(startDate);
        const previousStartDate = new Date(startDate);
        previousStartDate.setDate(previousEndDate.getDate() - period);

        // Current Period Queries
        const currentClicks = await this.eventsRepository
            .createQueryBuilder('event')
            .leftJoin('event.pixel', 'pixel')
            .where('pixel.userId = :userId', { userId })
            .andWhere('event.event = :eventType', { eventType: 'PageView' })
            .andWhere('event.timestamp >= :startDate', { startDate: startDate.getTime().toString() })
            .getCount();

        const currentLeads = await this.eventsRepository
            .createQueryBuilder('event')
            .leftJoin('event.pixel', 'pixel')
            .where('pixel.userId = :userId', { userId })
            .andWhere('event.event = :eventType', { eventType: 'Lead' })
            .andWhere('event.timestamp >= :startDate', { startDate: startDate.getTime().toString() })
            .getCount();

        const currentPurchases = await this.eventsRepository
            .createQueryBuilder('event')
            .leftJoin('event.pixel', 'pixel')
            .where('pixel.userId = :userId', { userId })
            .andWhere('event.event = :eventType', { eventType: 'Purchase' })
            .andWhere('event.timestamp >= :startDate', { startDate: startDate.getTime().toString() })
            .getCount();

        // Previous Period Queries
        const previousClicks = await this.eventsRepository
            .createQueryBuilder('event')
            .leftJoin('event.pixel', 'pixel')
            .where('pixel.userId = :userId', { userId })
            .andWhere('event.event = :eventType', { eventType: 'PageView' })
            .andWhere('event.timestamp >= :startDate', { startDate: previousStartDate.getTime().toString() })
            .andWhere('event.timestamp < :endDate', { endDate: startDate.getTime().toString() })
            .getCount();

        const previousLeads = await this.eventsRepository
            .createQueryBuilder('event')
            .leftJoin('event.pixel', 'pixel')
            .where('pixel.userId = :userId', { userId })
            .andWhere('event.event = :eventType', { eventType: 'Lead' })
            .andWhere('event.timestamp >= :startDate', { startDate: previousStartDate.getTime().toString() })
            .andWhere('event.timestamp < :endDate', { endDate: startDate.getTime().toString() })
            .getCount();

        const previousPurchases = await this.eventsRepository
            .createQueryBuilder('event')
            .leftJoin('event.pixel', 'pixel')
            .where('pixel.userId = :userId', { userId })
            .andWhere('event.event = :eventType', { eventType: 'Purchase' })
            .andWhere('event.timestamp >= :startDate', { startDate: previousStartDate.getTime().toString() })
            .andWhere('event.timestamp < :endDate', { endDate: startDate.getTime().toString() })
            .getCount();

        // Calculations
        const calculateChange = (current: number, previous: number) => {
            if (previous === 0) return current > 0 ? 100 : 0;
            return ((current - previous) / previous) * 100;
        };

        const currentConversionRate = currentClicks > 0 ? ((currentLeads + currentPurchases) / currentClicks) * 100 : 0;
        const previousConversionRate = previousClicks > 0 ? ((previousLeads + previousPurchases) / previousClicks) * 100 : 0;

        // Top Pages Query
        const topPagesQuery = await this.eventsRepository
            .createQueryBuilder('event')
            .leftJoin('event.pixel', 'pixel')
            .select("COALESCE(NULLIF(event.pageTitle, ''), 'Página sem título')", "name")
            .addSelect("COUNT(CASE WHEN event.event = 'PageView' THEN 1 END)", "visits")
            .addSelect("COUNT(CASE WHEN event.event IN ('Lead', 'Purchase') THEN 1 END)", "conversions")
            .where('pixel.userId = :userId', { userId })
            .andWhere('event.timestamp >= :startDate', { startDate: startDate.getTime().toString() })
            .groupBy("name")
            .orderBy("conversions", "DESC")
            .addOrderBy("visits", "DESC")
            .limit(5)
            .getRawMany();

        const topPages = topPagesQuery.map(page => {
            const visits = parseInt(page.visits);
            const conversions = parseInt(page.conversions);

            return {
                name: page.name,
                visits,
                conversions,
                rate: visits > 0 ? parseFloat(((conversions / visits) * 100).toFixed(1)) : 0
            };
        });

        // Breakdown Queries

        // 1. Abandoned Carts (Proxy: InitiateCheckout)
        const allAbandonedCarts = await this.eventsRepository
            .createQueryBuilder('event')
            .leftJoin('event.pixel', 'pixel')
            .select(['event.id', 'event.data'])
            .where('pixel.userId = :userId', { userId })
            .andWhere('event.event = :eventType', { eventType: 'InitiateCheckout' })
            .andWhere('event.timestamp >= :startDate', { startDate: startDate.getTime().toString() })
            .getMany();

        let abandonedTotalCount = allAbandonedCarts.length;
        let abandonedTotalValue = 0;
        const abandonedProductStats = new Map<string, { product: string, count: number, value: number }>();

        for (const event of allAbandonedCarts) {
            const data = event.data || {};
            const val = parseFloat(data.value || 0);
            abandonedTotalValue += val;

            const productName = data.content_name || 'Produto Desconhecido';
            if (!abandonedProductStats.has(productName)) {
                abandonedProductStats.set(productName, { product: productName, count: 0, value: 0 });
            }
            const stats = abandonedProductStats.get(productName)!;
            stats.count++;
            stats.value += val;
        }

        const topAbandonedItems = [...abandonedProductStats.values()]
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);

        // 2. Completed Purchases
        // 2. Metrics Logic (Purchases, Top Products, Top Customers)
        const allPurchases = await this.eventsRepository
            .createQueryBuilder('event')
            .leftJoin('event.pixel', 'pixel')
            .select(['event.id', 'event.data', 'event.sku', 'event.timestamp'])
            .where('pixel.userId = :userId', { userId })
            .andWhere('event.event = :eventType', { eventType: 'Purchase' })
            .andWhere('event.timestamp >= :startDate', { startDate: startDate.getTime().toString() })
            .orderBy('event.timestamp', 'DESC')
            .getMany();

        // Process in-memory for accuracy
        let totalPurchasesValue = 0;
        const totalPurchasesCount = allPurchases.length;
        const productStats = new Map<string, { name: string, sales: number, revenue: number, key: string }>();
        const customerStats = new Map<string, { name: string, purchases: number, total: number }>();
        const skuToName = new Map<string, string>();
        const allObservedSkus = new Set<string>();

        // First pass: Collect SKUs and calculate Customer/Total stats
        for (const event of allPurchases) {
            const data = event.data || {};
            const val = parseFloat(data.value || 0);
            totalPurchasesValue += val;

            const custName = data.customer_name || 'Cliente Anônimo';
            if (!customerStats.has(custName)) customerStats.set(custName, { name: custName, purchases: 0, total: 0 });
            const cs = customerStats.get(custName)!;
            cs.purchases++;
            cs.total += val;

            // Collect tokens and quantities
            const items: { sku: string, quantity: number }[] = [];

            if (Array.isArray(data.items)) {
                data.items.forEach((i: any) => {
                    if (i.sku || i.id) items.push({ sku: i.sku || i.id, quantity: Number(i.quantity) || 1 });
                });
            } else if (Array.isArray(data.contents)) {
                data.contents.forEach((i: any) => {
                    if (i.id) items.push({ sku: i.id, quantity: Number(i.quantity) || 1 });
                });
            } else {
                // Fallback to simple SKU/SKUS
                const tokens: string[] = [];
                if (event.sku) tokens.push(event.sku);
                else if (data.sku) tokens.push(data.sku);
                else if (data.content_id) tokens.push(data.content_id);
                else if (Array.isArray(data.skus)) tokens.push(...data.skus);

                const uniqueTokens = [...new Set(tokens.filter(t => t))];
                if (uniqueTokens.length === 0) uniqueTokens.push('unknown');

                uniqueTokens.forEach(t => items.push({ sku: t, quantity: 1 }));
            }

            (event as any).parsedItems = items;
            items.forEach(i => allObservedSkus.add(i.sku));
        }

        // Fetch Product Names
        if (allObservedSkus.size > 0) {
            const products = await this.productsRepository.find({
                where: { sku: In([...allObservedSkus]) }
            });
            products.forEach(p => skuToName.set(p.sku, p.name));
        }

        // Second pass: Aggregate Products using Resolved Names
        for (const event of allPurchases) {
            const data = event.data || {};
            const val = parseFloat(data.value || 0);
            const items = (event as any).parsedItems as { sku: string, quantity: number }[];

            const totalQuantity = items.reduce((acc, i) => acc + i.quantity, 0) || 1;
            const unitValue = val / totalQuantity;

            for (const item of items) {
                const name = skuToName.get(item.sku) || data.content_name || 'Produto Desconhecido';
                const key = item.sku === 'unknown' ? name : item.sku;

                if (!productStats.has(key)) {
                    productStats.set(key, { name: name === 'Produto Desconhecido' && item.sku !== 'unknown' ? item.sku : name, sales: 0, revenue: 0, key });
                }
                const ps = productStats.get(key)!;
                ps.sales += item.quantity;
                ps.revenue += unitValue * item.quantity;
            }
        }

        const topProductsList = [...productStats.values()]
            .sort((a, b) => b.sales - a.sales)
            .slice(0, 5);

        const topCustomersList = [...customerStats.values()]
            .sort((a, b) => b.total - a.total)
            .slice(0, 5);

        // Formatting Helpers
        const formatCurrency = (val: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0);

        const clicksBreakdown = {
            abandonedCarts: {
                total: abandonedTotalCount,
                value: formatCurrency(abandonedTotalValue),
                items: topAbandonedItems.map(item => ({
                    product: item.product,
                    count: item.count,
                    value: formatCurrency(item.value)
                }))
            },
            completedPurchases: {
                total: totalPurchasesCount,
                value: formatCurrency(totalPurchasesValue),
                avgTicket: formatCurrency(totalPurchasesCount > 0 ? totalPurchasesValue / totalPurchasesCount : 0),
                items: allPurchases.slice(0, 5).map(event => {
                    const data = event.data || {};
                    const items = (event as any).parsedItems as { sku: string, quantity: number }[];
                    const productNames = items.map(i => {
                        const name = skuToName.get(i.sku) || data.content_name || i.sku || 'Produto Desconhecido';
                        return i.quantity > 1 ? `${i.quantity}x ${name}` : name;
                    }).filter((v, i, a) => a.indexOf(v) === i); // Unique names

                    return {
                        date: new Date(parseInt(event.timestamp)).toLocaleDateString('pt-BR'),
                        customer: data.customer_name || 'Cliente Anônimo',
                        product: productNames.join(', '),
                        value: formatCurrency(parseFloat(data.value || '0'))
                    };
                })
            },
            topProducts: topProductsList.map(item => ({
                name: item.name,
                sales: item.sales,
                revenue: formatCurrency(item.revenue),
                conversion: 0
            })),
            topCustomers: topCustomersList.map(item => ({
                name: item.name,
                purchases: item.purchases,
                total: formatCurrency(item.total)
            }))
        };

        return {
            clicks: {
                value: currentClicks,
                change: calculateChange(currentClicks, previousClicks),
            },
            leads: {
                value: currentLeads,
                change: calculateChange(currentLeads, previousLeads),
            },
            conversionRate: {
                value: currentConversionRate,
                change: calculateChange(currentConversionRate, previousConversionRate),
            },
            topPages,
            clicksBreakdown
        };
    }

    private anonimizeIp(ip: string): string {
        if (!ip) return 'unknown';
        // Simplemente anonimizar el último octeto/segmento
        if (ip.includes('.')) {
            // IPv4
            return ip.split('.').slice(0, 3).join('.') + '.0';
        } else if (ip.includes(':')) {
            // IPv6
            return ip.split(':').slice(0, 3).join(':') + '::0';
        }
        return ip;
    }
}
