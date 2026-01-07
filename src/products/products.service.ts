import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from '../entities/product.entity';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { NuvemshopService } from '../nuvemshop/nuvemshop.service';
import { ShopifyService } from '../shopify/shopify.service';

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    @InjectRepository(Product)
    private productRepository: Repository<Product>,
    private nuvemshopService: NuvemshopService,
    private shopifyService: ShopifyService,
  ) {}

  async create(userId: number, createProductDto: CreateProductDto): Promise<Product> {
    const product = this.productRepository.create({
      ...createProductDto,
      userId,
      stock: createProductDto.stock ?? 0,
      active: createProductDto.active ?? true,
    });

    return this.productRepository.save(product);
  }

  async findAll(userId: number): Promise<Product[]> {
    return this.productRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: number, userId: number): Promise<Product> {
    const product = await this.productRepository.findOne({
      where: { id, userId },
    });

    if (!product) {
      throw new NotFoundException('Produto não encontrado');
    }

    return product;
  }

  async update(
    id: number,
    userId: number,
    updateProductDto: UpdateProductDto,
  ): Promise<Product> {
    const product = await this.findOne(id, userId);

    Object.assign(product, updateProductDto);
    const updatedProduct = await this.productRepository.save(product);

    // Recarregar o produto do banco para garantir que temos o externalIds atualizado
    const productWithExternalIds = await this.productRepository.findOne({
      where: { id: updatedProduct.id, userId },
    });

    // Sincronizar automaticamente com integrações ativas
    if (productWithExternalIds) {
      this.syncToIntegrations(userId, productWithExternalIds).catch((error) => {
        this.logger.error('Erro ao sincronizar produto com integrações:', error);
        // Não lançar erro para não quebrar a atualização do produto local
      });
    }

    return updatedProduct;
  }

  /**
   * Sincroniza o produto com todas as integrações ativas (Nuvemshop e Shopify)
   */
  private async syncToIntegrations(userId: number, product: Product): Promise<void> {
    // Tentar ler externalIds, mas se não existir (campo não criado ainda), usar objeto vazio
    let externalIds: { nuvemshop?: Record<string, number>; shopify?: Record<string, string> } = {};
    try {
      externalIds = (product.externalIds as any) || { nuvemshop: {}, shopify: {} };
    } catch (error) {
      // Campo externalIds não existe ainda (migration não executada)
      this.logger.warn(`Campo externalIds não disponível para produto ${product.id}. Execute a migration.`);
      externalIds = { nuvemshop: {}, shopify: {} };
    }
    let hasChanges = false;

    // Sincronizar com Nuvemshop
    try {
      const nuvemshopConnections = await this.nuvemshopService.getConnections(userId);
      const activeNuvemshopConnections = nuvemshopConnections.filter((c) => c.isActive);

      for (const connection of activeNuvemshopConnections) {
        try {
          // Verificar se já temos o ID salvo
          let existingProductId = externalIds.nuvemshop?.[connection.storeId];

          this.logger.debug(
            `Sincronizando produto ${product.id} com Nuvemshop. ID existente: ${existingProductId || 'não encontrado'}, SKU: ${product.sku || 'não informado'}, Nome: ${product.name}`,
          );

          // Se não temos ID, buscar por SKU ou nome para evitar duplicatas
          if (!existingProductId) {
            if (product.sku) {
              this.logger.debug(`Buscando produto por SKU: ${product.sku}`);
              existingProductId = await this.findNuvemshopProductBySku(
                userId,
                connection.storeId,
                product.sku,
              );
              if (existingProductId) {
                this.logger.log(`Produto encontrado por SKU na Nuvemshop: ${existingProductId}`);
              }
            }
            
            // Se não encontrou por SKU, tentar por nome
            if (!existingProductId && product.name) {
              this.logger.debug(`Buscando produto por nome: ${product.name}`);
              existingProductId = await this.findNuvemshopProductByName(
                userId,
                connection.storeId,
                product.name,
              );
              if (existingProductId) {
                this.logger.log(`Produto encontrado por nome na Nuvemshop: ${existingProductId}`);
                // Salvar o ID encontrado imediatamente para evitar buscar novamente
                if (!externalIds.nuvemshop) {
                  externalIds.nuvemshop = {};
                }
                externalIds.nuvemshop[connection.storeId] = existingProductId;
                hasChanges = true;
              }
            }
          }
          
          // Se encontrou ID por SKU, também salvar
          if (existingProductId && !externalIds.nuvemshop?.[connection.storeId]) {
            if (!externalIds.nuvemshop) {
              externalIds.nuvemshop = {};
            }
            externalIds.nuvemshop[connection.storeId] = existingProductId;
            hasChanges = true;
            this.logger.debug(`ID encontrado por SKU/nome salvo: ${existingProductId}`);
          }

          const nuvemshopProductData = this.convertToNuvemshopFormat(product, existingProductId);
          
          this.logger.debug(
            `Enviando produto para Nuvemshop: ${existingProductId ? 'PUT (atualizar)' : 'POST (criar)'}, ID: ${existingProductId || 'novo'}`,
          );
          
          const result = await this.nuvemshopService.syncProduct(
            userId,
            connection.storeId,
            nuvemshopProductData,
          );

          // Salvar o ID retornado (a API da Nuvemshop retorna o produto com o campo 'id')
          // Se já tínhamos um ID (encontrado por SKU/nome), usar esse, senão usar o retornado
          const returnedProductId = result?.id || existingProductId;
          if (returnedProductId) {
            if (!externalIds.nuvemshop) {
              externalIds.nuvemshop = {};
            }
            externalIds.nuvemshop[connection.storeId] = returnedProductId;
            hasChanges = true;
            this.logger.debug(`ID salvo no externalIds: ${returnedProductId} para storeId: ${connection.storeId}`);
          }

          this.logger.log(
            `Produto ${product.id} ${existingProductId ? 'atualizado' : 'criado'} na Nuvemshop (storeId: ${connection.storeId}, productId: ${returnedProductId})`,
          );
        } catch (error) {
          this.logger.error(
            `Erro ao sincronizar produto ${product.id} com Nuvemshop (storeId: ${connection.storeId}):`,
            error,
          );
        }
      }
    } catch (error) {
      this.logger.error('Erro ao buscar conexões Nuvemshop:', error);
    }

    // Sincronizar com Shopify
    try {
      const shopifyConnections = await this.shopifyService.getConnections(userId);
      const activeShopifyConnections = shopifyConnections.filter((c) => c.isActive);

      for (const connection of activeShopifyConnections) {
        try {
          // Verificar se já temos o ID salvo
          let existingProductId = externalIds.shopify?.[connection.shop];

          // Se não temos ID, buscar por SKU para evitar duplicatas
          if (!existingProductId && product.sku) {
            existingProductId = await this.findShopifyProductBySku(
              userId,
              connection.shop,
              product.sku,
            );
            // Salvar o ID encontrado imediatamente para evitar buscar novamente
            if (existingProductId && !externalIds.shopify?.[connection.shop]) {
              if (!externalIds.shopify) {
                externalIds.shopify = {};
              }
              externalIds.shopify[connection.shop] = existingProductId;
              hasChanges = true;
              this.logger.debug(`ID encontrado por SKU na Shopify salvo: ${existingProductId}`);
            }
          }

          const shopifyProductData = this.convertToShopifyFormat(product, existingProductId);
          
          const result = await this.shopifyService.syncProduct(userId, connection.shop, shopifyProductData);

          // Salvar o ID retornado (formato GraphQL: gid://shopify/Product/123456)
          // O método syncProduct do Shopify retorna result.data?.productSet?.product
          const returnedProductId = result?.id;
          if (returnedProductId) {
            if (!externalIds.shopify) {
              externalIds.shopify = {};
            }
            externalIds.shopify[connection.shop] = returnedProductId;
            hasChanges = true;
          }

          this.logger.log(
            `Produto ${product.id} ${existingProductId ? 'atualizado' : 'criado'} na Shopify (shop: ${connection.shop}, productId: ${returnedProductId})`,
          );
        } catch (error) {
          this.logger.error(
            `Erro ao sincronizar produto ${product.id} com Shopify (shop: ${connection.shop}):`,
            error,
          );
        }
      }
    } catch (error) {
      this.logger.error('Erro ao buscar conexões Shopify:', error);
    }

    // Salvar os IDs externos atualizados
    if (hasChanges) {
      try {
        product.externalIds = externalIds as any;
        await this.productRepository.save(product);
        this.logger.log(`IDs externos salvos para produto ${product.id}`);
      } catch (error) {
        // Se o campo não existe ainda, apenas logar aviso
        this.logger.warn(
          `Não foi possível salvar externalIds para produto ${product.id}. Execute a migration para adicionar o campo.`,
        );
      }
    }
  }

  /**
   * Converte o produto do formato Nucleo CRM para o formato Nuvemshop
   */
  private convertToNuvemshopFormat(
    product: Product,
    existingProductId?: number,
  ): {
    name: { pt?: string; en?: string; es?: string };
    description?: { pt?: string; en?: string; es?: string };
    variants: Array<{
      price: string;
      stock_management: boolean;
      stock: number;
      weight: string;
      sku?: string;
    }>;
    images?: Array<{ src: string }>;
    categories?: number[];
    id?: number;
  } {
    return {
      ...(existingProductId && { id: existingProductId }), // Incluir ID se existir para atualizar
      name: {
        pt: product.name,
      },
      description: product.description
        ? {
            pt: product.description,
          }
        : undefined,
      variants: [
        {
          price: (typeof product.price === 'number' ? product.price : parseFloat(String(product.price)) || 0).toFixed(2),
          stock_management: true,
          stock: typeof product.stock === 'number' ? product.stock : parseInt(String(product.stock)) || 0,
          weight: '0.50', // Peso padrão, pode ser configurável no futuro
          sku: product.sku || undefined,
        },
      ],
      // TODO: Adicionar suporte para imagens quando disponível
      // images: product.images ? product.images.map(img => ({ src: img })) : undefined,
    };
  }

  /**
   * Busca um produto na Nuvemshop pelo SKU
   */
  private async findNuvemshopProductBySku(
    userId: number,
    storeId: string,
    sku: string,
  ): Promise<number | undefined> {
    try {
      this.logger.debug(`Buscando produto na Nuvemshop por SKU: ${sku} (storeId: ${storeId})`);
      const products = await this.nuvemshopService.getProducts(userId, storeId, { limit: 250 });
      
      this.logger.debug(`Total de produtos encontrados na Nuvemshop: ${products.length}`);
      
      for (const product of products) {
        // Verificar se alguma variante tem o SKU correspondente
        if (product.variants && Array.isArray(product.variants)) {
          const matchingVariant = product.variants.find((v: any) => v.sku === sku);
          if (matchingVariant && product.id) {
            this.logger.log(`Produto encontrado na Nuvemshop por SKU: ${sku} -> Product ID: ${product.id}`);
            return product.id;
          }
        }
      }
      
      this.logger.debug(`Nenhum produto encontrado na Nuvemshop com SKU: ${sku}`);
    } catch (error) {
      this.logger.error(`Erro ao buscar produto por SKU na Nuvemshop: ${sku}`, error);
    }
    return undefined;
  }

  /**
   * Busca um produto na Nuvemshop pelo nome
   */
  private async findNuvemshopProductByName(
    userId: number,
    storeId: string,
    name: string,
  ): Promise<number | undefined> {
    try {
      this.logger.debug(`Buscando produto na Nuvemshop por nome: ${name} (storeId: ${storeId})`);
      const products = await this.nuvemshopService.getProducts(userId, storeId, { limit: 250 });
      
      this.logger.debug(`Total de produtos encontrados na Nuvemshop: ${products.length}`);
      
      for (const product of products) {
        // A Nuvemshop retorna o nome como objeto { pt, en, es } ou string
        let productName = '';
        if (typeof product.name === 'object' && product.name !== null) {
          productName = product.name.pt || product.name.en || product.name.es || '';
        } else if (typeof product.name === 'string') {
          productName = product.name;
        }
        
        // Comparar nomes (case-insensitive, sem espaços extras)
        if (productName.trim().toLowerCase() === name.trim().toLowerCase() && product.id) {
          this.logger.log(`Produto encontrado na Nuvemshop por nome: ${name} -> Product ID: ${product.id}`);
          return product.id;
        }
      }
      
      this.logger.debug(`Nenhum produto encontrado na Nuvemshop com nome: ${name}`);
    } catch (error) {
      this.logger.error(`Erro ao buscar produto por nome na Nuvemshop: ${name}`, error);
    }
    return undefined;
  }

  /**
   * Busca um produto na Shopify pelo SKU
   * Retorna o ID no formato GraphQL (gid://shopify/Product/123456)
   */
  private async findShopifyProductBySku(
    userId: number,
    shop: string,
    sku: string,
  ): Promise<string | undefined> {
    try {
      const products = await this.shopifyService.getProducts(userId, shop, { limit: 250 });
      
      for (const product of products) {
        // Verificar se alguma variante tem o SKU correspondente
        if (product.variants && Array.isArray(product.variants)) {
          const matchingVariant = product.variants.find((v: any) => v.sku === sku);
          if (matchingVariant && product.id) {
            // Converter ID numérico para formato GraphQL
            // Se já estiver no formato GraphQL, retornar como está
            if (typeof product.id === 'string' && product.id.startsWith('gid://')) {
              return product.id;
            }
            // Se for numérico, converter para formato GraphQL
            return `gid://shopify/Product/${product.id}`;
          }
        }
      }
    } catch (error) {
      this.logger.warn(`Erro ao buscar produto por SKU na Shopify: ${sku}`, error);
    }
    return undefined;
  }

  /**
   * Converte o produto do formato Nucleo CRM para o formato Shopify (GraphQL)
   */
  private convertToShopifyFormat(
    product: Product,
    existingProductId?: string,
  ): {
    title: string;
    variants?: Array<{
      optionValues: Array<{ optionName: string; name: string }>;
      price: string;
      sku?: string;
      inventoryQuantity?: number;
    }>;
    id?: string;
  } {
    return {
      ...(existingProductId && { id: existingProductId }), // Incluir ID se existir para atualizar
      title: product.name,
      variants: [
        {
          optionValues: [], // Produto simples sem opções
          price: (typeof product.price === 'number' ? product.price : parseFloat(String(product.price)) || 0).toFixed(2),
          sku: product.sku || undefined,
          inventoryQuantity: typeof product.stock === 'number' ? product.stock : parseInt(String(product.stock)) || 0,
        },
      ],
    };
  }

  async remove(id: number, userId: number): Promise<void> {
    const product = await this.findOne(id, userId);
    await this.productRepository.remove(product);
  }
}

