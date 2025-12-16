import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { ContactPurchase } from '../entities/contact-purchase.entity';
import { Contact } from '../entities/contact.entity';
import { Product } from '../entities/product.entity';
import { Sale } from '../entities/sale.entity';
import { CreateContactPurchaseDto } from './dto/create-contact-purchase.dto';
import { UpdateContactPurchaseDto } from './dto/update-contact-purchase.dto';

@Injectable()
export class ContactPurchasesService {
  constructor(
    @InjectRepository(ContactPurchase)
    private contactPurchasesRepository: Repository<ContactPurchase>,
    @InjectRepository(Contact)
    private contactsRepository: Repository<Contact>,
    @InjectRepository(Product)
    private productsRepository: Repository<Product>,
    @InjectRepository(Sale)
    private salesRepository: Repository<Sale>,
    @InjectDataSource()
    private dataSource: DataSource,
  ) {}

  async create(
    userId: number,
    createDto: CreateContactPurchaseDto,
  ): Promise<ContactPurchase> {
    // Usar transação para garantir consistência
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Verificar se o contato pertence ao usuário
      const contact = await queryRunner.manager.findOne(Contact, {
        where: { id: createDto.contactId, userId },
      });

      if (!contact) {
        throw new NotFoundException(`Contato com ID ${createDto.contactId} não encontrado ou não pertence ao usuário`);
      }

      let product: Product | null = null;
      let sale: Sale | null = null;
      const quantity = createDto.quantity || 1;

      // Se houver productId, verificar produto e estoque
      if (createDto.productId) {
        product = await queryRunner.manager.findOne(Product, {
          where: { id: createDto.productId, userId },
        });

        if (!product) {
          throw new NotFoundException(`Produto com ID ${createDto.productId} não encontrado ou não pertence ao usuário`);
        }

        // Verificar se há estoque suficiente
        if (product.stock < quantity) {
          throw new BadRequestException(
            `Estoque insuficiente. Disponível: ${product.stock}, Solicitado: ${quantity}`
          );
        }

        // Calcular preço unitário (valor total dividido pela quantidade)
        const totalValue = createDto.value;
        const unitPrice = totalValue / quantity;

        // Criar registro na tabela sales
        const saleData: Partial<Sale> = {
          productId: product.id,
          userId,
          quantity,
          unitPrice,
          totalValue,
          customerName: contact.name,
          status: 'completed',
        };
        
        if (contact.email) {
          saleData.customerEmail = contact.email;
        }
        
        sale = queryRunner.manager.create(Sale, saleData);

        await queryRunner.manager.save(Sale, sale);

        // Diminuir estoque do produto
        product.stock = product.stock - quantity;
        await queryRunner.manager.save(Product, product);
      }

      // Criar registro na tabela contact_purchases
      const purchase = queryRunner.manager.create(ContactPurchase, {
        ...createDto,
        purchaseDate: new Date(createDto.purchaseDate),
      });

      const savedPurchase = await queryRunner.manager.save(ContactPurchase, purchase);

      // Commit da transação
      await queryRunner.commitTransaction();

      return savedPurchase;
    } catch (error) {
      // Rollback em caso de erro
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      // Liberar query runner
      await queryRunner.release();
    }
  }

  async findAllByContact(
    userId: number,
    contactId: number,
  ): Promise<ContactPurchase[]> {
    return this.contactPurchasesRepository.find({
      where: {
        contact: {
          id: contactId,
          userId,
        },
      },
      relations: ['product'],
      order: { purchaseDate: 'DESC' },
    });
  }

  async findAllByUser(userId: number): Promise<ContactPurchase[]> {
    return this.contactPurchasesRepository
      .createQueryBuilder('purchase')
      .innerJoin('purchase.contact', 'contact')
      .where('contact.userId = :userId', { userId })
      .leftJoinAndSelect('purchase.product', 'product')
      .orderBy('purchase.purchaseDate', 'DESC')
      .getMany();
  }

  async findOne(
    userId: number,
    id: number,
  ): Promise<ContactPurchase> {
    const purchase = await this.contactPurchasesRepository
      .createQueryBuilder('purchase')
      .innerJoin('purchase.contact', 'contact')
      .where('purchase.id = :id', { id })
      .andWhere('contact.userId = :userId', { userId })
      .leftJoinAndSelect('purchase.product', 'product')
      .getOne();

    if (!purchase) {
      throw new NotFoundException(`Compra com ID ${id} não encontrada`);
    }

    return purchase;
  }

  async update(
    userId: number,
    id: number,
    updateDto: UpdateContactPurchaseDto,
  ): Promise<ContactPurchase> {
    const purchase = await this.findOne(userId, id);

    if (updateDto.purchaseDate) {
      purchase.purchaseDate = new Date(updateDto.purchaseDate);
    }
    if (updateDto.value !== undefined) {
      purchase.value = updateDto.value;
    }
    if (updateDto.productId !== undefined) {
      purchase.productId = updateDto.productId;
    }
    if (updateDto.productName !== undefined) {
      purchase.productName = updateDto.productName;
    }
    if (updateDto.paymentMethod !== undefined) {
      purchase.paymentMethod = updateDto.paymentMethod;
    }
    if (updateDto.status !== undefined) {
      purchase.status = updateDto.status;
    }

    return this.contactPurchasesRepository.save(purchase);
  }

  async remove(userId: number, id: number): Promise<void> {
    const purchase = await this.findOne(userId, id);
    await this.contactPurchasesRepository.remove(purchase);
  }

  async getContactLTV(contactId: number): Promise<number> {
    const result = await this.contactPurchasesRepository
      .createQueryBuilder('purchase')
      .select('SUM(purchase.value)', 'total')
      .where('purchase.contactId = :contactId', { contactId })
      .andWhere('purchase.status = :status', { status: 'completed' })
      .getRawOne();

    return parseFloat(result?.total || '0');
  }
}

