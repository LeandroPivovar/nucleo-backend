import {
    Injectable,
    NotFoundException,
    BadRequestException,
    Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { LojaIntegradaConnection } from '../entities/loja-integrada-connection.entity';
import { Contact } from '../entities/contact.entity';
import { Sale } from '../entities/sale.entity';
import { Product } from '../entities/product.entity';
import * as crypto from 'crypto';

@Injectable()
export class LojaIntegradaService {
    private readonly baseUrl = 'https://api.awsli.com.br/v1';
    private readonly logger = new Logger(LojaIntegradaService.name);

    constructor(
        @InjectRepository(LojaIntegradaConnection)
        private connectionRepository: Repository<LojaIntegradaConnection>,
        @InjectRepository(Contact)
        private contactRepository: Repository<Contact>,
        @InjectRepository(Sale)
        private saleRepository: Repository<Sale>,
        @InjectRepository(Product)
        private productRepository: Repository<Product>,
        private configService: ConfigService,
    ) { }

    private encrypt(text: string): string {
        const algorithm = 'aes-256-cbc';
        const secret = this.configService.get<string>('SHOPIFY_CLIENT_SECRET') || 'default-secret';
        const key = crypto.createHash('sha256').update(secret).digest();
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv(algorithm, key, iv);
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        return iv.toString('hex') + ':' + encrypted;
    }

    private decrypt(encryptedText: string): string {
        const algorithm = 'aes-256-cbc';
        const secret = this.configService.get<string>('SHOPIFY_CLIENT_SECRET') || 'default-secret';
        const key = crypto.createHash('sha256').update(secret).digest();
        const parts = encryptedText.split(':');
        const iv = Buffer.from(parts[0], 'hex');
        const encrypted = parts[1];
        const decipher = crypto.createDecipheriv(algorithm, key, iv);
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    }

    async createOrUpdateConnection(
        userId: number,
        storeName: string,
        apiKey: string,
        applicationKey?: string,
    ): Promise<LojaIntegradaConnection> {
        let connection = await this.connectionRepository.findOne({
            where: { userId, storeName },
        });

        const encryptedApiKey = this.encrypt(apiKey);
        const encryptedAppKey = applicationKey ? this.encrypt(applicationKey) : '';

        if (connection) {
            connection.apiKey = encryptedApiKey;
            connection.applicationKey = encryptedAppKey;
            connection.isActive = true;
        } else {
            connection = this.connectionRepository.create({
                userId,
                storeName,
                apiKey: encryptedApiKey,
                applicationKey: encryptedAppKey || '',
                isActive: true,
            });
        }

        return await this.connectionRepository.save(connection);
    }

    async getActiveConnection(userId: number): Promise<LojaIntegradaConnection> {
        const connection = await this.connectionRepository.findOne({
            where: { userId, isActive: true },
        });
        if (!connection) throw new NotFoundException('Conexão Loja Integrada não encontrada');
        return connection;
    }

    private async makeRequest(connection: LojaIntegradaConnection, endpoint: string, params: any = {}, method: string = 'GET', body?: any): Promise<any> {
        const apiKey = this.decrypt(connection.apiKey);

        // Prioritize global app key from .env, fallback to connection-specific one
        const globalAppKey = this.configService.get<string>('LOJA_INTEGRADA_APP_KEY');
        const appKey = (globalAppKey && globalAppKey !== 'your_application_key_here')
            ? globalAppKey
            : (connection.applicationKey ? this.decrypt(connection.applicationKey) : '');

        if (!appKey) {
            this.logger.error('LOJA_INTEGRADA_APP_KEY não configurada no .env e nenhuma chave por conexão disponível');
        }

        const url = new URL(`${this.baseUrl}${endpoint}`);
        url.searchParams.append('format', 'json');
        
        if (method === 'GET') {
            Object.keys(params).forEach(key => url.searchParams.append(key, params[key]));
        }

        const options: RequestInit = {
            method,
            headers: {
                'Authorization': `chave_api ${apiKey} aplicacao ${appKey}`,
                'Content-Type': 'application/json',
            },
        };

        if (body) {
            options.body = JSON.stringify(body);
        }

        this.logger.log(`[Loja Integrada API Request] ${method} ${url.toString()}`);
        if (body) {
            this.logger.debug(`[Loja Integrada API Payload] ${JSON.stringify(body)}`);
        }

        const response = await fetch(url.toString(), options);

        if (!response.ok) {
            const error = await response.text();
            this.logger.error(`[Loja Integrada API Error] ${method} ${endpoint}: ${error}`);
            throw new BadRequestException(`Falha na comunicação com a Loja Integrada: ${error}`);
        }

        const data = await response.json();
        this.logger.debug(`[Loja Integrada API Response] ${JSON.stringify(data).substring(0, 1000)}${JSON.stringify(data).length > 1000 ? '...' : ''}`);
        
        return data;
    }

    /**
     * Cria um cupom de desconto na Loja Integrada
     */
    async createCoupon(
        userId: number,
        params: {
            codigo: string;
            tipo: 'fixo' | 'porcentagem' | 'frete_gratis';
            valor?: string | number;
            ativo?: boolean;
            validade?: string;
            valor_minimo?: string;
            quantidade?: number;
            quantidade_por_cliente?: number;
            cumulativo?: boolean;
            descricao?: string;
        }
    ): Promise<any> {
        const connection = await this.getActiveConnection(userId);
        
        // Tipos corretos conforme documentação oficial da Loja Integrada
        // porcentagem | fixo | frete_gratis
        // Nenhuma transformação necessária - os nomes internos já são os corretos da API

        // Formatar data para YYYY-MM-DD (ISO)
        let validade = params.validade;
        if (validade && validade.includes('T')) {
            validade = validade.split('T')[0];
        }

        const body = {
            codigo: params.codigo,
            tipo: params.tipo, // 'porcentagem' | 'fixo' | 'frete_gratis'
            valor: params.valor ? parseFloat(params.valor.toString()) : 0,
            validade,
            ativo: params.ativo ?? true,
            valor_minimo: parseFloat((params.valor_minimo || '0').toString()), // número, não string
            quantidade: params.quantidade ?? 1,
            quantidade_por_cliente: params.quantidade_por_cliente ?? 1,
            ...(params.cumulativo !== undefined && { cumulativo: params.cumulativo }),
            ...(params.descricao && { descricao: params.descricao }),
        };

        return await this.makeRequest(connection, '/cupom/', {}, 'POST', body);
    }

    async syncProducts(userId: number): Promise<{ imported: number; updated: number }> {
        const connection = await this.getActiveConnection(userId);
        
        // Normaliza URI para uso como chave de mapa (remove prefixo /api se presente)
        const normalizeUri = (uri: string) => uri?.replace(/^\/api/, '') || uri;

        // 1. Buscar Preços (Bulk/Paginado)
        const priceMap = new Map();
        let priceOffset = 0;
        let hasMorePrices = true;
        while (hasMorePrices && priceOffset < 500) { // Limite de segurança de 500 produtos
            const priceData = await this.makeRequest(connection, '/produto_preco/', { limit: 100, offset: priceOffset });
            if (priceData && priceData.objects && priceData.objects.length > 0) {
                priceData.objects.forEach(p => {
                    priceMap.set(normalizeUri(p.produto), p.promocional || p.cheio || '0');
                });
                priceOffset += 100;
                if (priceData.objects.length < 100) hasMorePrices = false;
            } else {
                hasMorePrices = false;
            }
        }

        // 2. Buscar Estoque (Bulk/Paginado)
        const stockMap = new Map();
        let stockOffset = 0;
        let hasMoreStocks = true;
        while (hasMoreStocks && stockOffset < 500) {
            const stockData = await this.makeRequest(connection, '/produto_estoque/', { limit: 100, offset: stockOffset });
            if (stockData && stockData.objects && stockData.objects.length > 0) {
                stockData.objects.forEach(s => {
                    // campo correto da API: quantidade_disponivel (estoque disponível para venda)
                    stockMap.set(normalizeUri(s.produto), s.quantidade_disponivel ?? s.quantidade ?? 0);
                });
                stockOffset += 100;
                if (stockData.objects.length < 100) hasMoreStocks = false;
            } else {
                hasMoreStocks = false;
            }
        }

        // 3. Buscar Produtos e mesclar
        let imported = 0;
        let updated = 0;
        let productOffset = 0;
        let hasMoreProducts = true;

        while (hasMoreProducts && productOffset < 500) {
            const data = await this.makeRequest(connection, '/produto/', { limit: 100, offset: productOffset });
            const liProducts = data.objects || [];
            
            if (liProducts.length === 0) {
                hasMoreProducts = false;
                break;
            }

            for (const liProduct of liProducts) {
                const productUri = normalizeUri(liProduct.resource_uri);
                const price = priceMap.get(productUri) || '0';
                const stock = stockMap.get(productUri) || 0;

                let product = await this.productRepository.findOne({
                    where: { userId, sku: liProduct.sku },
                });

                if (product) {
                    product.name = liProduct.nome;
                    product.price = parseFloat(price);
                    product.stock = stock;
                    product.active = liProduct.ativo;
                    await this.productRepository.save(product);
                    updated++;
                } else {
                    product = this.productRepository.create({
                        userId,
                        sku: liProduct.sku,
                        name: liProduct.nome,
                        price: parseFloat(price),
                        stock: stock,
                        active: liProduct.ativo,
                    });
                    await this.productRepository.save(product);
                    imported++;
                }
            }

            productOffset += 100;
            if (liProducts.length < 100) hasMoreProducts = false;
        }

        return { imported, updated };
    }

    async syncOrders(userId: number): Promise<{ imported: number }> {
        const connection = await this.getActiveConnection(userId);
        let imported = 0;
        let offset = 0;
        let hasMore = true;

        while (hasMore) {
            const data = await this.makeRequest(connection, '/pedido/', { limit: 50, offset });
            const liOrders = data.objects || [];

            if (liOrders.length === 0) break;

            for (const liOrder of liOrders) {
                // Guard: número do pedido deve existir
                if (!liOrder.numero) continue;

                let order: any;
                try {
                    order = await this.makeRequest(connection, `/pedido/${liOrder.numero}/`);
                } catch (e) {
                    this.logger.warn(`[LI Sync] Falha ao buscar pedido ${liOrder.numero}: ${e.message}`);
                    continue;
                }

                // Guard: cliente e email obrigatórios
                const customerEmail = (order.cliente?.email || '').toLowerCase().trim();
                if (!customerEmail) continue;

                let contact = await this.contactRepository.findOne({ where: { userId, email: customerEmail } });
                const name = order.cliente?.nome || 'Sem Nome';
                
                if (!contact) {
                    contact = this.contactRepository.create({
                        userId,
                        email: customerEmail,
                        name,
                        source: 'loja_integrada',
                        status: 'customer',
                    });
                    await this.contactRepository.save(contact);
                } else {
                    let updatedContact = false;
                    if (!contact.name || contact.name === 'Sem Nome') {
                        contact.name = name;
                        updatedContact = true;
                    }
                    if (updatedContact) {
                        await this.contactRepository.save(contact);
                    }
                }

                // Guard: itens do pedido podem ser null
                for (const item of (order.itens || [])) {
                    const externalId = `loja_integrada_${order.numero}_${item.id}`;
                    const existingSale = await this.saleRepository.findOne({ where: { userId, externalId } });

                    if (!existingSale) {
                        // Guard: sku pode ser undefined/null
                        let product = item.sku
                            ? await this.productRepository.findOne({ where: { userId, sku: item.sku } })
                            : null;

                        if (!product) {
                            product = this.productRepository.create({
                                userId,
                                sku: item.sku || '',
                                name: item.nome || 'Produto sem nome',
                                price: parseFloat(item.preco_venda) || 0,
                                stock: 0,
                                active: true,
                            });
                            await this.productRepository.save(product);
                        }

                        let statusMatch = 'processing';
                        const situacaoCodigo = order.situacao?.codigo;
                        if (situacaoCodigo === 'pedido_cancelado') statusMatch = 'cancelled';
                        else if (situacaoCodigo === 'pedido_entregue') statusMatch = 'delivered';
                        else if (situacaoCodigo === 'pedido_pago') statusMatch = 'completed';
                        else if (situacaoCodigo === 'aguardando_pagamento') statusMatch = 'pending';

                        // Campo correto da API: pagamentos (array), não pagamento (singular)
                        const paymentMethod = order.pagamentos?.[0]?.forma_pagamento?.nome
                            || order.pagamentos?.[0]?.forma_pagamento?.codigo
                            || null;

                        const sale = this.saleRepository.create({
                            userId,
                            productId: product.id,
                            contactId: contact.id,
                            quantity: item.quantidade,
                            unitPrice: parseFloat(item.preco_venda) || 0,
                            totalValue: (parseFloat(item.preco_venda) || 0) * (item.quantidade || 1),
                            customerName: contact.name,
                            customerEmail: customerEmail,
                            channel: 'loja_integrada',
                            status: statusMatch,
                            paymentMethod,
                            createdAt: new Date(order.data_criacao),
                            externalId,
                            // campo correto da API da Loja Integrada para cupom do pedido
                            couponCode: order.cupom_desconto || null,
                        });
                        await this.saleRepository.save(sale);
                        imported++;
                    }
                }
            }

            offset += 50;
            if (liOrders.length < 50) hasMore = false;
        }

        return { imported };
    }

    async syncCheckouts(userId: number): Promise<{ imported: number }> {
        const connection = await this.getActiveConnection(userId);
        // situacao_id é o parâmetro correto da API LI v1 (não status_id)
        const data = await this.makeRequest(connection, '/pedido/', { situacao_id: 'aguardando_pagamento', limit: 50 });
        const liOrders = data.objects || [];
        let imported = 0;

        for (const liOrder of liOrders) {
            if (!liOrder.numero) continue;

            let order: any;
            try {
                order = await this.makeRequest(connection, `/pedido/${liOrder.numero}/`);
            } catch (e) {
                this.logger.warn(`[LI Checkout Sync] Falha ao buscar pedido ${liOrder.numero}: ${e.message}`);
                continue;
            }

            const customerEmail = (order.cliente?.email || '').toLowerCase().trim();
            if (!customerEmail) continue;

            let contact = await this.contactRepository.findOne({ where: { userId, email: customerEmail } });
            const name = order.cliente?.nome || 'Sem Nome';

            if (!contact) {
                contact = this.contactRepository.create({
                    userId,
                    email: customerEmail,
                    name,
                    source: 'loja_integrada',
                    status: 'lead',
                });
                await this.contactRepository.save(contact);
            } else {
                let updatedContact = false;
                if (!contact.name || contact.name === 'Sem Nome') {
                    contact.name = name;
                    updatedContact = true;
                }
                if (updatedContact) {
                    await this.contactRepository.save(contact);
                }
            }

            for (const item of (order.itens || [])) {
                const externalId = `loja_integrada_checkout_${order.numero}_${item.id}`;
                const existingSale = await this.saleRepository.findOne({ where: { userId, externalId } });

                if (!existingSale) {
                    let product = item.sku
                        ? await this.productRepository.findOne({ where: { userId, sku: item.sku } })
                        : null;

                    if (!product) {
                        product = this.productRepository.create({
                            userId,
                            sku: item.sku || '',
                            name: item.nome || 'Produto sem nome',
                            price: parseFloat(item.preco_venda) || 0,
                            stock: 0,
                            active: true,
                        });
                        await this.productRepository.save(product);
                    }

                    // Check if it's considered abandoned (e.g. older than 2 hours)
                    const createdAt = new Date(order.data_criacao);
                    const hoursOld = (new Date().getTime() - createdAt.getTime()) / (1000 * 60 * 60);
                    const status = hoursOld > 2 ? 'abandoned_cart' : 'active_cart';

                    const sale = this.saleRepository.create({
                        userId,
                        productId: product.id,
                        contactId: contact.id,
                        quantity: item.quantidade,
                        unitPrice: parseFloat(item.preco_venda) || 0,
                        totalValue: (parseFloat(item.preco_venda) || 0) * (item.quantidade || 1),
                        customerName: contact.name,
                        customerEmail: customerEmail,
                        channel: 'loja_integrada',
                        status,
                        createdAt,
                        externalId,
                        // campo correto da API da Loja Integrada para cupom do pedido
                        couponCode: order.cupom_desconto || null,
                    });
                    await this.saleRepository.save(sale);
                    imported++;
                }
            }
        }
        return { imported };
    }

    async syncAll(userId: number): Promise<any> {
        const products = await this.syncProducts(userId);
        const orders = await this.syncOrders(userId);
        const checkouts = await this.syncCheckouts(userId);
        return { products, orders, checkouts };
    }
}
