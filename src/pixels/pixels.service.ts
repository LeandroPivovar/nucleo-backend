import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, Between } from 'typeorm';
import { Pixel } from '../entities/pixel.entity';
import { PixelEvent } from '../entities/pixel-event.entity';
import { CreatePixelDto } from './dto/create-pixel.dto';
import { TrackEventDto } from './dto/track-event.dto';
import { randomUUID } from 'crypto';

import { Product } from '../entities/product.entity';
import { Sale } from '../entities/sale.entity';
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
        @InjectRepository(Sale)
        private saleRepository: Repository<Sale>,
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

                            try {
                                const newContact = await this.contactsService.create(pixel.userId, {
                                    name: nameWithLast,
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

        // Aggregations in memory for reliability and flexibility
        const allEvents = await this.eventsRepository
            .createQueryBuilder('event')
            .leftJoin('event.pixel', 'pixel')
            .select(['event.id', 'event.event', 'event.pageTitle', 'event.timestamp', 'event.url', 'event.sessionId'])
            .where('pixel.userId = :userId', { userId })
            .andWhere('event.timestamp >= :startDate', { startDate: startDate.getTime().toString() })
            .getMany();

        const pageStats = new Map<string, { name: string, visits: number, conversions: number }>();
        const utmSourceStats = new Map<string, { visits: number, conversions: number }>();
        const sessionIds = new Set<string>();
        const sessionsWithClicks = new Set<string>();
        const sessionsWithLeads = new Set<string>();

        const getUtmSource = (urlStr: string) => {
            try {
                if (!urlStr) return 'Direto / Orgânico';
                const url = new URL(urlStr);
                return url.searchParams.get('utm_source') || 'Direto / Orgânico';
            } catch {
                return 'Direto / Orgânico';
            }
        };

        for (const event of allEvents) {
            // Sessions & Funnel
            if (event.sessionId) {
                sessionIds.add(event.sessionId);
                if (event.event === 'PageView') sessionsWithClicks.add(event.sessionId);
                if (['Lead', 'Purchase'].includes(event.event)) sessionsWithLeads.add(event.sessionId);
            }

            // UTM Sources attribution
            const source = getUtmSource(event.url);
            if (!utmSourceStats.has(source)) {
                utmSourceStats.set(source, { visits: 0, conversions: 0 });
            }
            const sStat = utmSourceStats.get(source)!;

            // Top Pages
            const pageName = event.pageTitle || 'Página sem título';
            if (!pageStats.has(pageName)) {
                pageStats.set(pageName, { name: pageName, visits: 0, conversions: 0 });
            }
            const pStats = pageStats.get(pageName)!;

            if (event.event === 'PageView') {
                pStats.visits++;
                sStat.visits++;
            } else if (['Lead', 'Purchase'].includes(event.event)) {
                pStats.conversions++;
                sStat.conversions++;
            }
        }

        const topPages = [...pageStats.values()]
            .sort((a, b) => b.conversions - a.conversions || b.visits - a.visits)
            .slice(0, 5)
            .map(page => ({
                name: page.name,
                visits: page.visits,
                conversions: page.conversions,
                rate: page.visits > 0 ? parseFloat(((page.conversions / page.visits) * 100).toFixed(1)) : 0
            }));

        const funnelData = [
            { name: 'Visitantes', value: sessionIds.size, color: 'bg-blue-500' },
            { name: 'Cliques', value: sessionsWithClicks.size, color: 'bg-purple-500' },
            { name: 'Conversões', value: sessionsWithLeads.size, color: 'bg-green-500' }
        ];

        const totalVisits = [...utmSourceStats.values()].reduce((a, b) => a + b.visits, 0);
        const conversionSources = [...utmSourceStats.entries()]
            .sort((a, b) => b[1].conversions - a[1].conversions || b[1].visits - a[1].visits)
            .slice(0, 4)
            .map(([source, stats], idx) => {
                const colors = ['bg-blue-500', 'bg-red-500', 'bg-pink-500', 'bg-green-500'];
                return {
                    source,
                    conversions: stats.conversions,
                    visits: stats.visits,
                    percentage: totalVisits > 0 ? parseFloat(((stats.visits / totalVisits) * 100).toFixed(1)) : 0,
                    color: colors[idx] || 'bg-gray-500'
                };
            });

        // Breakdown Queries (General System + Pixels)

        // 1. Abandoned Carts
        // Fetch InitiateCheckout from Pixels
        const pixelAbandonedCarts = await this.eventsRepository
            .createQueryBuilder('event')
            .leftJoin('event.pixel', 'pixel')
            .select(['event.id', 'event.data'])
            .where('pixel.userId = :userId', { userId })
            .andWhere('event.event = :eventType', { eventType: 'InitiateCheckout' })
            .andWhere('event.timestamp >= :startDate', { startDate: startDate.getTime().toString() })
            .getMany();

        // Fetch Abandoned Carts from Sale table (Shopify, Nuvemshop, etc.)
        const salesAbandonedCarts = await this.saleRepository.find({
            where: {
                userId,
                status: In(['active_cart', 'abandoned_cart']),
                createdAt: Between(startDate, endDate)
            },
            relations: ['product']
        });

        let abandonedTotalCount = 0;
        let abandonedTotalValue = 0;
        const abandonedProductStats = new Map<string, { product: string, count: number, value: number }>();

        // Merge Pixel Abandoned Carts
        for (const event of pixelAbandonedCarts) {
            const data = event.data || {};
            const val = parseFloat(data.value || 0);
            abandonedTotalCount++;
            abandonedTotalValue += val;

            const productName = data.content_name || 'Produto Desconhecido';
            if (!abandonedProductStats.has(productName)) {
                abandonedProductStats.set(productName, { product: productName, count: 0, value: 0 });
            }
            const stats = abandonedProductStats.get(productName)!;
            stats.count++;
            stats.value += val;
        }

        // Merge Sales Abandoned Carts (avoid double counting by checking if they are 'pixel' channel with same value? 
        // Better: count all as "General System" requires total view)
        for (const sale of salesAbandonedCarts) {
            // Se for do canal 'pixel', provavelmente já está contato via pixelAbandonedCarts (InitiateCheckout)
            // mas o initiating checkout pode não ter gerado um Sale record ainda.
            // Para ser simples e "Geral do sistema", vamos somar tudo o que não for duplicado.
            // Na dúvida, somamos os de integração que o pixel não pega.
            if (sale.channel !== 'pixel') {
                abandonedTotalCount++;
                abandonedTotalValue += Number(sale.totalValue);

                const productName = sale.product?.name || 'Produto Desconhecido';
                if (!abandonedProductStats.has(productName)) {
                    abandonedProductStats.set(productName, { product: productName, count: 0, value: 0 });
                }
                const stats = abandonedProductStats.get(productName)!;
                stats.count++;
                stats.value += Number(sale.totalValue);
            }
        }

        const topAbandonedItems = [...abandonedProductStats.values()]
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);

        // 2. Leads (for Top Forms) - Keep Pixel only as it's the source
        const allLeadsEvents = await this.eventsRepository
            .createQueryBuilder('event')
            .leftJoin('event.pixel', 'pixel')
            .select(['event.id', 'event.data', 'event.pageTitle', 'event.url'])
            .where('pixel.userId = :userId', { userId })
            .andWhere('event.event = :eventType', { eventType: 'Lead' })
            .andWhere('event.timestamp >= :startDate', { startDate: startDate.getTime().toString() })
            .getMany();

        const formStats = new Map<string, { name: string, submissions: number, visits: number }>();
        for (const event of allLeadsEvents) {
            const data = event.data || {};
            const formName = data.form_name || data.content_name || event.pageTitle || 'Formulário s/ Nome';
            if (!formStats.has(formName)) {
                formStats.set(formName, { name: formName, submissions: 0, visits: 0 });
            }
            formStats.get(formName)!.submissions++;
        }

        for (const [name, stats] of formStats) {
            const pStat = pageStats.get(name);
            if (pStat) stats.visits = pStat.visits;
        }

        const topForms = [...formStats.values()]
            .sort((a, b) => b.submissions - a.submissions)
            .slice(0, 5)
            .map(f => ({
                name: f.name,
                submissions: f.submissions,
                rate: f.visits > 0 ? parseFloat(((f.submissions / f.visits) * 100).toFixed(1)) : 0,
                efficiency: (f.submissions / (f.visits || 1)) > 0.3 ? 'Alta' : (f.submissions / (f.visits || 1)) > 0.1 ? 'Média' : 'Baixa'
            }));

        // 3. Completed Purchases & Top Products (General System)
        // Fetch Completed Sales from Sale table (Source of Truth for General System)
        const allSystemSales = await this.saleRepository.find({
            where: {
                userId,
                status: 'completed',
                createdAt: Between(startDate, endDate)
            },
            relations: ['product', 'contact'],
            order: { createdAt: 'DESC' }
        });

        // Fetch Purchases from Pixels (that might not have been converted to Sales)
        const pixelPurchases = await this.eventsRepository
            .createQueryBuilder('event')
            .leftJoin('event.pixel', 'pixel')
            .select(['event.id', 'event.data', 'event.sku', 'event.timestamp'])
            .where('pixel.userId = :userId', { userId })
            .andWhere('event.event = :eventType', { eventType: 'Purchase' })
            .andWhere('event.timestamp >= :startDate', { startDate: startDate.getTime().toString() })
            .getMany();

        let totalPurchasesValue = 0;
        let totalPurchasesCount = 0;
        const productStats = new Map<string, { name: string, sales: number, revenue: number, key: string }>();
        const customerStats = new Map<string, { name: string, purchases: number, total: number }>();
        const skuToName = new Map<string, string>();
        
        // Process System Sales
        for (const sale of allSystemSales) {
            const val = Number(sale.totalValue);
            totalPurchasesValue += val;
            totalPurchasesCount++;

            const custName = sale.customerName || sale.contact?.name || 'Cliente Anônimo';
            if (!customerStats.has(custName)) customerStats.set(custName, { name: custName, purchases: 0, total: 0 });
            const cs = customerStats.get(custName)!;
            cs.purchases++;
            cs.total += val;

            const productName = sale.product?.name || 'Produto Desconhecido';
            const sku = sale.product?.sku || 'unknown';
            if (!productStats.has(productName)) {
                productStats.set(productName, { name: productName, sales: 0, revenue: 0, key: sku });
            }
            const ps = productStats.get(productName)!;
            ps.sales += sale.quantity;
            ps.revenue += val;
        }

        // Merge Pixel Purchases NOT in Sales (Avoid double counting)
        for (const event of pixelPurchases) {
            // If the event resulted in a Sale, it's already counted
            // We'll skip it if there's a Sale with channel 'pixel' and similar characteristic?
            // Actually, for simplicity and because "General System" usually means the sum of everything:
            // if Sale.channel === 'pixel' was created from THIS event, we shouldn't add it.
            // But tracking from event to sale isn't 1:1 in DB easily without an eventId in Sale.
            // However, most Pixel Purchases DO create Sales.
            // To be safe, we only add PixelPurchases that don't seem to be in Sales.
            // Or better: just use Sales for purchases, and if someone wants Pixel data specifically they have other tools.
            // But the user wants "não só os dos links, mas do geral".
            // So I will just use Sales as the source for completed purchases, and only add Pixel if it's missing.
            // Actually, I'll just use the Sales table for "Completed Purchases" as it already includes Pixel Sales.
        }

        const topProductsList = [...productStats.values()]
            .sort((a, b) => b.sales - a.sales)
            .slice(0, 5);

        const topCustomersList = [...customerStats.values()]
            .sort((a, b) => b.total - a.total)
            .slice(0, 5);

        // Payment Methods (from Sales)
        const paymentMethodStats = new Map<string, { method: string, usage: number, total: number }>();
        for (const sale of allSystemSales) {
            const method = sale.paymentMethod || 'Outro';
            if (!paymentMethodStats.has(method)) {
                paymentMethodStats.set(method, { method, usage: 0, total: 0 });
            }
            const ps = paymentMethodStats.get(method)!;
            ps.usage++;
            ps.total += Number(sale.totalValue);
        }

        const paymentMethods = [...paymentMethodStats.values()]
            .sort((a, b) => b.usage - a.usage)
            .map((pm, idx) => {
                const colors = ['bg-teal-500', 'bg-purple-500', 'bg-orange-500', 'bg-blue-500'];
                return {
                    method: pm.method,
                    usage: pm.usage,
                    percentage: totalPurchasesCount > 0 ? parseFloat(((pm.usage / totalPurchasesCount) * 100).toFixed(1)) : 0,
                    color: colors[idx] || 'bg-gray-500',
                    avgTime: 'N/A'
                };
            });

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
                items: allSystemSales.slice(0, 5).map(sale => ({
                    date: new Date(sale.createdAt).toLocaleDateString('pt-BR'),
                    customer: sale.customerName || sale.contact?.name || 'Cliente Anônimo',
                    product: sale.product?.name || 'Produto Desconhecido',
                    value: formatCurrency(Number(sale.totalValue))
                }))
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
            funnelData,
            conversionSources,
            paymentMethods,
            topForms,
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
