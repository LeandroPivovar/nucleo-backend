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

    // Sincronizar automaticamente com integrações ativas
    this.syncToIntegrations(userId, updatedProduct).catch((error) => {
      this.logger.error('Erro ao sincronizar produto com integrações:', error);
      // Não lançar erro para não quebrar a atualização do produto local
    });

    return updatedProduct;
  }

  /**
   * Sincroniza o produto com todas as integrações ativas (Nuvemshop e Shopify)
   */
  private async syncToIntegrations(userId: number, product: Product): Promise<void> {
    // Sincronizar com Nuvemshop
    try {
      const nuvemshopConnections = await this.nuvemshopService.getConnections(userId);
      const activeNuvemshopConnections = nuvemshopConnections.filter((c) => c.isActive);

      for (const connection of activeNuvemshopConnections) {
        try {
          const nuvemshopProductData = this.convertToNuvemshopFormat(product);
          await this.nuvemshopService.syncProduct(
            userId,
            connection.storeId,
            nuvemshopProductData,
          );
          this.logger.log(
            `Produto ${product.id} sincronizado com Nuvemshop (storeId: ${connection.storeId})`,
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
          const shopifyProductData = this.convertToShopifyFormat(product);
          await this.shopifyService.syncProduct(userId, connection.shop, shopifyProductData);
          this.logger.log(
            `Produto ${product.id} sincronizado com Shopify (shop: ${connection.shop})`,
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
  }

  /**
   * Converte o produto do formato Nucleo CRM para o formato Nuvemshop
   */
  private convertToNuvemshopFormat(product: Product): {
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
          price: product.price.toFixed(2),
          stock_management: true,
          stock: product.stock || 0,
          weight: '0.50', // Peso padrão, pode ser configurável no futuro
          sku: product.sku || undefined,
        },
      ],
      // TODO: Adicionar suporte para imagens quando disponível
      // images: product.images ? product.images.map(img => ({ src: img })) : undefined,
    };
  }

  /**
   * Converte o produto do formato Nucleo CRM para o formato Shopify (GraphQL)
   */
  private convertToShopifyFormat(product: Product): {
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
      title: product.name,
      variants: [
        {
          optionValues: [], // Produto simples sem opções
          price: product.price.toFixed(2),
          sku: product.sku || undefined,
          inventoryQuantity: product.stock || 0,
        },
      ],
      // TODO: Armazenar o ID do produto na Shopify para atualizações futuras
      // id: product.shopifyProductId,
    };
  }

  async remove(id: number, userId: number): Promise<void> {
    const product = await this.findOne(id, userId);
    await this.productRepository.remove(product);
  }
}

