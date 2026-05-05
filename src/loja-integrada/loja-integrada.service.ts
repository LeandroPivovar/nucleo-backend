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

        const response = await fetch(url.toString(), options);

        if (!response.ok) {
            const error = await response.text();
            this.logger.error(`[Loja Integrada] Erro na requisição ${method} ${endpoint}: ${error}`);
            throw new BadRequestException(`Falha na comunicação com a Loja Integrada: ${error}`);
        }

        return await response.json();
    }

    /**
     * Cria um cupom de desconto na Loja Integrada
     */
    async createCoupon(
        userId: number,
        params: {
            codigo: string;
            tipo: 'fixo' | 'porcentagem' | 'frete_gratis';
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
        
        // Formatar datas para DD/MM/YYYY se for string ISO
        let validade = params.validade;
        if (validade && validade.includes('-')) {
            const date = new Date(validade);
            validade = `${date.getDate().toString().padStart(2, '0')}/${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getFullYear()}`;
        }

        const body = {
            ...params,
            validade,
            ativo: params.ativo ?? true,
            aplicar_no_total: params.tipo === 'frete_gratis' ? false : true,
            condicao_cliente: 'todos_clientes',
            condicao_produto: 'todos_produtos',
        };

        return await this.makeRequest(connection, '/cupom/', {}, 'POST', body);
    }

    async syncProducts(userId: number): Promise<{ imported: number }> {
        const connection = await this.getActiveConnection(userId);
        const data = await this.makeRequest(connection, '/produto/', { limit: 100 });
        const liProducts = data.objects || [];
        let imported = 0;

        for (const liProduct of liProducts) {
            let product = await this.productRepository.findOne({
                where: { userId, sku: liProduct.sku },
            });

            if (product) {
                product.name = liProduct.nome;
                product.price = parseFloat(liProduct.preco_venda || liProduct.preco_cheio || '0');
                await this.productRepository.save(product);
            } else {
                product = this.productRepository.create({
                    userId,
                    sku: liProduct.sku,
                    name: liProduct.nome,
                    price: parseFloat(liProduct.preco_venda || liProduct.preco_cheio || '0'),
                    stock: 0,
                    active: liProduct.ativo,
                });
                await this.productRepository.save(product);
                imported++;
            }
        }
        return { imported };
    }

    async syncOrders(userId: number): Promise<{ imported: number }> {
        const connection = await this.getActiveConnection(userId);
        const data = await this.makeRequest(connection, '/pedido/', { limit: 50 });
        const liOrders = data.objects || [];
        let imported = 0;

        for (const liOrder of liOrders) {
            // LI list endpoint only returns basic info. We need full info for customer/items.
            const order = await this.makeRequest(connection, `/pedido/${liOrder.numero}/`);

            const customerEmail = (order.cliente.email || '').toLowerCase().trim();
            if (!customerEmail) continue;

            let contact = await this.contactRepository.findOne({ where: { userId, email: customerEmail } });
            const name = order.cliente.nome || 'Sem Nome';
            
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
                // Atualizar dados do contato se estiverem vazios
                let updatedContact = false;
                if (!contact.name || contact.name === 'Sem Nome') {
                    contact.name = name;
                    updatedContact = true;
                }
                if (updatedContact) {
                    await this.contactRepository.save(contact);
                }
            }

            for (const item of order.itens) {
                const externalId = `loja_integrada_${order.numero}_${item.id}`;
                let existingSale = await this.saleRepository.findOne({ where: { userId, externalId } });

                if (!existingSale) {
                    // Find product by SKU
                    let product = await this.productRepository.findOne({ where: { userId, sku: item.sku } });
                    if (!product) {
                        product = this.productRepository.create({
                            userId,
                            sku: item.sku || '',
                            name: item.nome || 'Produto sem nome',
                            price: parseFloat(item.preco_venda),
                            stock: 0,
                            active: true,
                        });
                        await this.productRepository.save(product);
                    }

                    let statusMatch = 'processing';
                    if (order.situacao?.codigo === 'pedido_cancelado') {
                        statusMatch = 'cancelled';
                    } else if (order.situacao?.codigo === 'pedido_entregue') {
                        statusMatch = 'delivered';
                    } else if (order.situacao?.codigo === 'pedido_pago') {
                        statusMatch = 'completed';
                    } else if (order.situacao?.codigo === 'aguardando_pagamento') {
                        statusMatch = 'pending';
                    }

                    const paymentMethod = order.pagamento?.codigo || order.pagamento?.nome || null;

                    const sale = this.saleRepository.create({
                        userId,
                        productId: product.id,
                        contactId: contact.id,
                        quantity: item.quantidade,
                        unitPrice: parseFloat(item.preco_venda),
                        totalValue: parseFloat(item.preco_venda) * item.quantidade,
                        customerName: contact.name,
                        customerEmail: customerEmail,
                        channel: 'loja_integrada',
                        status: statusMatch,
                        paymentMethod: paymentMethod,
                        createdAt: new Date(order.data_criacao),
                        externalId,
                    });
                    await this.saleRepository.save(sale);
                    imported++;
                }
            }
        }
        return { imported };
    }

    async syncCheckouts(userId: number): Promise<{ imported: number }> {
        const connection = await this.getActiveConnection(userId);
        // As per docs, we infer abandoned checkouts from 'aguardando_pagamento'
        const data = await this.makeRequest(connection, '/pedido/', { status_id: 'aguardando_pagamento', limit: 50 });
        const liOrders = data.objects || [];
        let imported = 0;

        for (const liOrder of liOrders) {
            const order = await this.makeRequest(connection, `/pedido/${liOrder.numero}/`);
            const customerEmail = (order.cliente.email || '').toLowerCase().trim();
            if (!customerEmail) continue;

            let contact = await this.contactRepository.findOne({ where: { userId, email: customerEmail } });
            const name = order.cliente.nome || 'Sem Nome';

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
                // Atualizar dados do contato se estiverem vazios
                let updatedContact = false;
                if (!contact.name || contact.name === 'Sem Nome') {
                    contact.name = name;
                    updatedContact = true;
                }
                if (updatedContact) {
                    await this.contactRepository.save(contact);
                }
            }

            for (const item of order.itens) {
                const externalId = `loja_integrada_checkout_${order.numero}_${item.id}`;
                let existingSale = await this.saleRepository.findOne({ where: { userId, externalId } });

                if (!existingSale) {
                    let product = await this.productRepository.findOne({ where: { userId, sku: item.sku } });
                    if (!product) {
                        product = this.productRepository.create({
                            userId,
                            sku: item.sku || '',
                            name: item.nome || 'Produto sem nome',
                            price: parseFloat(item.preco_venda),
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
                        unitPrice: parseFloat(item.preco_venda),
                        totalValue: parseFloat(item.preco_venda) * item.quantidade,
                        customerName: contact.name,
                        customerEmail: customerEmail,
                        channel: 'loja_integrada',
                        status,
                        createdAt,
                        externalId,
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
