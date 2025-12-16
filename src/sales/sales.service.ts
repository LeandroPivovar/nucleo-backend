import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Sale } from '../entities/sale.entity';
import { Product } from '../entities/product.entity';
import { CreateSaleDto } from './dto/create-sale.dto';

@Injectable()
export class SalesService {
  constructor(
    @InjectRepository(Sale)
    private saleRepository: Repository<Sale>,
    @InjectRepository(Product)
    private productRepository: Repository<Product>,
  ) {}

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
}

