import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Contact } from '../entities/contact.entity';
import { ContactTag } from '../entities/contact-tag.entity';
import { ContactSegmentation } from '../entities/contact-segmentation.entity';
import { Tag } from '../entities/tag.entity';
import { Group } from '../entities/group.entity';
import { ContactPurchase } from '../entities/contact-purchase.entity';
import { Sale } from '../entities/sale.entity';
import { CampaignCoupon } from '../entities/campaign-coupon.entity';
import { CampaignClick } from '../entities/campaign-click.entity';
import { CampaignQueue } from '../entities/campaign-queue.entity';

import { CreateContactDto } from './dto/create-contact.dto';

import { UpdateContactDto } from './dto/update-contact.dto';
import { ImportContactRow } from './dto/import-contacts.dto';

export interface SegmentationParam {
  id: string;
  params?: {
    days?: number;
    minPurchases?: number;
    minTicket?: number;
    [key: string]: any;
  };
}

@Injectable()
export class ContactsService {
  constructor(
    @InjectRepository(Contact)
    private contactsRepository: Repository<Contact>,
    @InjectRepository(ContactTag)
    private contactTagsRepository: Repository<ContactTag>,
    @InjectRepository(Tag)
    private tagsRepository: Repository<Tag>,
    @InjectRepository(Group)
    private groupsRepository: Repository<Group>,
    @InjectRepository(ContactSegmentation)
    private contactSegmentationsRepository: Repository<ContactSegmentation>,
    @InjectRepository(Sale)
    private saleRepository: Repository<Sale>,
    @InjectRepository(CampaignCoupon)
    private campaignCouponRepository: Repository<CampaignCoupon>,
    @InjectRepository(CampaignClick)
    private campaignClickRepository: Repository<CampaignClick>,
    @InjectRepository(CampaignQueue)
    private campaignQueueRepository: Repository<CampaignQueue>,

  ) { }


  async create(userId: number, createContactDto: CreateContactDto): Promise<Contact> {
    const { tagIds, groupId, ...contactData } = createContactDto;


    // Verificar se o grupo pertence ao usuário (se fornecido)
    if (groupId) {
      const group = await this.groupsRepository.findOne({
        where: { id: groupId, userId },
      });
      if (!group) {
        throw new NotFoundException(`Grupo com ID ${groupId} não encontrado ou não pertence ao usuário`);
      }
    }

    const contact = this.contactsRepository.create({
      ...contactData,
      userId,
      groupId: groupId ?? undefined,
    });
    const savedContact = await this.contactsRepository.save(contact);

    // Salvar tags se fornecidas
    if (tagIds && tagIds.length > 0) {
      // Verificar se todas as tags pertencem ao usuário
      const tags = await this.tagsRepository.find({
        where: tagIds.map(id => ({ id, userId })),
      });

      if (tags.length !== tagIds.length) {
        throw new NotFoundException('Uma ou mais tags não foram encontradas ou não pertencem ao usuário');
      }

      // Criar relacionamentos
      const contactTags = tagIds.map(tagId =>
        this.contactTagsRepository.create({
          contactId: savedContact.id,
          tagId,
        }),
      );
      await this.contactTagsRepository.save(contactTags);
    }

    // Retornar contato com relações carregadas
    return this.findOne(userId, savedContact.id);
  }


  async findAll(userId: number): Promise<Contact[]> {
    const now = new Date();

    const query = this.contactsRepository.createQueryBuilder('contact')
      .leftJoinAndSelect('contact.contactTags', 'ct')
      .leftJoinAndSelect('ct.tag', 'tag')
      .leftJoinAndSelect('contact.contactSegmentations', 'cs')
      .leftJoinAndSelect('contact.group', 'group')
      .leftJoinAndSelect('contact.sales', 'sales')
      .leftJoinAndSelect('sales.product', 'product')
      .where('contact.userId = :userId', { userId })
      .orderBy('contact.createdAt', 'DESC');

    // Add engagement flags as subqueries
    query.addSelect(subQuery => {
      return subQuery
        .select('COUNT(click.id) > 0', 'hasClicked')
        .from(CampaignClick, 'click')
        .where('click.contactId = contact.id')
        .andWhere('click.campaignId IN (SELECT id from campaigns where userId = :userId)', { userId });
    }, 'hasClickedCampaign');

    query.addSelect(subQuery => {
      return subQuery
        .select('COUNT(coupon.id) > 0', 'hasCoupon')
        .from(CampaignCoupon, 'coupon')
        .where('coupon.contactId = contact.id')
        .andWhere('coupon.userId = :userId', { userId })
        .andWhere('coupon.endsAt > :nowCount', { nowCount: now });
    }, 'hasActiveCoupon');


    const rawAndEntities = await query.getRawAndEntities();

    // Map the boolean flags from raw to entities
    return rawAndEntities.entities.map((entity) => {
      // TypeORM automatically aliases the primary key of the main entity to "entityAlias_id" or similar
      // We look for the raw row that matches our entity ID.
      const raw = rawAndEntities.raw.find(r => r.contact_id === entity.id);

      if (raw) {
        // Depending on DB driver, boolean might be 1/0 or true/false or '1'/'0'
        const hasClicked = raw.hasClickedCampaign;
        const hasCoupon = raw.hasActiveCoupon;

        entity.hasClickedCampaign = hasClicked === true || hasClicked === 1 || hasClicked === '1';
        entity.hasActiveCoupon = hasCoupon === true || hasCoupon === 1 || hasCoupon === '1';
      } else {
        entity.hasClickedCampaign = false;
        entity.hasActiveCoupon = false;
      }
      return entity;
    });


  }


  async findOne(userId: number, id: number): Promise<Contact> {
    const contact = await this.contactsRepository.findOne({
      where: { id, userId },
      relations: ['contactTags', 'contactTags.tag', 'contactSegmentations', 'group', 'sales', 'sales.product'],
    });

    if (!contact) {
      throw new NotFoundException(`Contato com ID ${id} não encontrado`);
    }

    return contact;
  }

  async findByEmail(userId: number, email: string): Promise<Contact | null> {
    return this.contactsRepository.findOne({
      where: { email, userId },
      relations: ['contactTags', 'contactTags.tag'],
    });
  }

  async update(
    userId: number,
    id: number,
    updateContactDto: UpdateContactDto,
  ): Promise<Contact> {
    const { tagIds, groupId, ...contactData } = updateContactDto;

    const contact = await this.findOne(userId, id);

    // Atualizar grupo se fornecido
    if (groupId !== undefined) {
      if (groupId === null) {
        contact.groupId = undefined;
      } else {
        const group = await this.groupsRepository.findOne({
          where: { id: groupId, userId },
        });
        if (!group) {
          throw new NotFoundException(`Grupo com ID ${groupId} não encontrado ou não pertence ao usuário`);
        }
        contact.groupId = groupId;
      }
    }

    // Atualizar dados do contato
    Object.assign(contact, contactData);
    const savedContact = await this.contactsRepository.save(contact);

    // Atualizar tags se fornecidas
    if (tagIds !== undefined) {
      // Remover tags existentes
      await this.contactTagsRepository.delete({ contactId: id });

      // Adicionar novas tags
      if (tagIds.length > 0) {
        // Verificar se todas as tags pertencem ao usuário
        const tags = await this.tagsRepository.find({
          where: tagIds.map(tagId => ({ id: tagId, userId })),
        });

        if (tags.length !== tagIds.length) {
          throw new NotFoundException('Uma ou mais tags não foram encontradas ou não pertencem ao usuário');
        }

        // Criar relacionamentos
        const contactTags = tagIds.map(tagId =>
          this.contactTagsRepository.create({
            contactId: id,
            tagId,
          }),
        );
        await this.contactTagsRepository.save(contactTags);
      }
    }

    // Retornar contato atualizado com relações
    return this.findOne(userId, id);
  }


  async remove(userId: number, id: number): Promise<void> {
    const contact = await this.findOne(userId, id);
    await this.contactsRepository.remove(contact);
  }

  async importFromCSV(userId: number, rows: ImportContactRow[]): Promise<{ created: number; errors: string[] }> {
    const errors: string[] = [];
    let created = 0;

    // Buscar todos os grupos e tags do usuário para mapeamento
    const userGroups = await this.groupsRepository.find({ where: { userId } });
    const userTags = await this.tagsRepository.find({ where: { userId } });

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const lineNumber = i + 2; // +2 porque linha 1 é cabeçalho e arrays começam em 0

      try {
        // Validar nome (obrigatório)
        if (!row.name || !row.name.trim()) {
          errors.push(`Linha ${lineNumber}: Nome é obrigatório`);
          continue;
        }

        // Separar nome e sobrenome
        const nameParts = row.name.trim().split(' ');
        const firstName = nameParts[0];
        const lastName = nameParts.slice(1).join(' ') || undefined;

        // Mapear grupo por nome
        let groupId: number | undefined = undefined;
        if (row.group && row.group.trim()) {
          const groupName = row.group.trim().toLowerCase();
          const group = userGroups.find(g => g.name.toLowerCase() === groupName);
          if (group) {
            groupId = group.id;
          }
          // Se grupo não encontrado, não cria erro, apenas ignora
        }

        // Mapear tags por nomes (separadas por ponto e vírgula)
        const tagIds: number[] = [];
        if (row.tags && row.tags.trim()) {
          const tagNames = row.tags.split(';').map(t => t.trim()).filter(t => t);
          for (const tagName of tagNames) {
            const tag = userTags.find(t => t.name.toLowerCase() === tagName.toLowerCase());
            if (tag) {
              tagIds.push(tag.id);
            }
            // Se tag não encontrada, não cria erro, apenas ignora
          }
        }

        // Mapear segmentações (separadas por ponto e vírgula)
        const segmentationIds: string[] = [];
        if (row.segmentations && row.segmentations.trim()) {
          const segIds = row.segmentations.split(';').map(s => s.trim()).filter(s => s);
          segmentationIds.push(...segIds);
        }

        // Criar contato
        const createDto: CreateContactDto = {
          name: firstName,
          lastName,
          email: row.email?.trim() || undefined,
          phone: row.phone?.trim() || undefined,
          status: row.status?.trim() || undefined,
          state: row.state?.trim() || undefined,
          city: row.city?.trim() || undefined,
          birthDate: row.birthDate?.trim() || undefined,
          gender: row.gender?.trim() || undefined,
          groupId,
          tagIds: tagIds.length > 0 ? tagIds : undefined,
        };


        await this.create(userId, createDto);
        created++;
      } catch (error) {
        errors.push(`Linha ${lineNumber}: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
      }
    }

    return { created, errors };
  }

  async getSegmentationStats(userId: number) {
    const stats: Record<string, number> = {};

    // 1. Total de Contatos
    stats['total'] = await this.contactsRepository.count({ where: { userId } });

    // 2. Por Estado (UF)
    const stateStats = await this.contactsRepository
      .createQueryBuilder('contact')
      .select('contact.state', 'state')
      .addSelect('COUNT(*)', 'count')
      .where('contact.userId = :userId', { userId })
      .andWhere('contact.state IS NOT NULL')
      .groupBy('contact.state')
      .getRawMany();

    stateStats.forEach(s => {
      const stateKey = s.state ? s.state.toLowerCase() : 'unknown';
      stats[`state_${stateKey}`] = parseInt(s.count);
    });

    // 3. Leads (status = 'lead')
    stats['lead_captured'] = await this.contactsRepository.count({
      where: { userId, status: 'lead' }
    });

    // 4. Clientes Inativos (Sem compras há mais de 90 dias)
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const active90Days = await this.saleRepository.createQueryBuilder('p')
      .select('DISTINCT p.contactId')
      .innerJoin('p.contact', 'c')
      .where('c.userId = :userId', { userId })
      .andWhere('p.createdAt >= :ninetyDaysAgo', { ninetyDaysAgo })
      .getRawMany();

    stats['inactive_customers'] = stats['total'] - active90Days.length;

    // 5. Clientes por número de compras (Pela menos 1 compra)
    const buyers = await this.saleRepository
      .createQueryBuilder('sale')
      .innerJoin('sale.contact', 'contact')
      .where('contact.userId = :userId', { userId })
      .select('DISTINCT contact.id')
      .getRawMany();

    stats['by_purchase_count'] = buyers.length;

    // 6. Ticket Médio Alto (Clientes com média > 500)
    const highTicket = await this.saleRepository
      .createQueryBuilder('sale')
      .innerJoin('sale.contact', 'contact')
      .where('contact.userId = :userId', { userId })
      .select('contact.id')
      .groupBy('contact.id')
      .having('AVG(sale.totalValue) > :value', { value: 500 })
      .getRawMany();

    stats['high_ticket'] = highTicket.length;

    // 7. Aniversariantes do Mês (Automático)
    const currentMonth = new Date().getMonth() + 1;
    stats['birthday'] = await this.contactsRepository
      .createQueryBuilder('contact')
      .where('contact.userId = :userId', { userId })
      .andWhere('EXTRACT(MONTH FROM contact.birthDate) = :currentMonth', { currentMonth })
      .getCount();

    // 8. Por Gênero (Automático)
    stats['gender_male'] = await this.contactsRepository.count({
      where: { userId, gender: 'M' }
    });
    stats['gender_female'] = await this.contactsRepository.count({
      where: { userId, gender: 'F' }
    });

    // 9. Cupom Ativo (Clientes com cupons não expirados)
    const now = new Date();
    const activeCouponContacts = await this.campaignCouponRepository
      .createQueryBuilder('coupon')
      .select('DISTINCT coupon.contactId')
      .where('coupon.userId = :userId', { userId })
      .andWhere('coupon.endsAt > :now', { now })
      .getRawMany();

    stats['active_coupon'] = activeCouponContacts.length;

    // 10. Clientes que não compram há 30 dias (Automático)

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const active30Days = await this.saleRepository.createQueryBuilder('p')
      .select('DISTINCT p.contactId')
      .innerJoin('p.contact', 'c')
      .where('c.userId = :userId', { userId })
      .andWhere('p.createdAt >= :thirtyDaysAgo', { thirtyDaysAgo })
      .getRawMany();

    stats['no_purchase_x_days'] = stats['total'] - active30Days.length;

    // 11. Engajados (Cliques em campanhas)
    const engajados = await this.campaignClickRepository
      .createQueryBuilder('click')
      .select('DISTINCT click.contactId')
      .where('click.campaignId IN (SELECT id from campaigns where userId = :userId)', { userId })
      .getRawMany();
    stats['clicked_campaign'] = engajados.length;

    // 12. Carrinho Abandonado (Vendas com status pending, active_cart ou abandoned_cart)
    const abandonedCarts = await this.saleRepository.createQueryBuilder('sale')
      .select('DISTINCT sale.contactId')
      .innerJoin('sale.contact', 'contact')
      .where('contact.userId = :userId', { userId })
      .andWhere('sale.status IN (:...statuses)', { statuses: ['pending', 'active_cart', 'abandoned_cart'] })
      .getRawMany();

    stats['abandoned_cart'] = abandonedCarts.length;
    stats['abandoned_cart_products'] = abandonedCarts.length; // Baseline count

    // 13. Cliente Recuperado (Teve carrinho abandonado E compra concluída)
    const recovered = await this.contactsRepository.createQueryBuilder('contact')
      .innerJoin('contact.sales', 's1', "s1.status = 'completed'")
      .innerJoin('contact.sales', 's2', "s2.status IN ('pending', 'active_cart', 'abandoned_cart') AND s1.createdAt > s2.createdAt")
      .where('contact.userId = :userId', { userId })
      .select('COUNT(DISTINCT contact.id)', 'count')
      .getRawOne();

    stats['cart_recovered_customer'] = parseInt(recovered.count || '0');

    // 14. Compram Produto Específico (Total Geral de Compradores como baseline)
    const totalShoppers = await this.saleRepository.createQueryBuilder('sale')
      .select('DISTINCT sale.contactId')
      .innerJoin('sale.contact', 'contact')
      .where('contact.userId = :userId', { userId })
      .andWhere("sale.status = 'completed'")
      .getRawMany();

    stats['purchased_product'] = totalShoppers.length;

    // 10. Contagem manual das segmentações persistidas (Fallback para o que ainda é manual)

    const manualStats = await this.contactSegmentationsRepository
      .createQueryBuilder('seg')
      .innerJoin('seg.contact', 'contact')
      .select('seg.segmentationId', 'id')
      .addSelect('COUNT(*)', 'count')
      .where('contact.userId = :userId', { userId })
      .groupBy('seg.segmentationId')
      .getRawMany();

    manualStats.forEach(s => {
      // Se já foi calculado dinamicamente acima e tem valor 0 ou não existe, usa o manual
      if (!stats[s.id]) {
        stats[s.id] = parseInt(s.count);
      }
    });

    // 11. Garantir que chaves comuns do frontend existam pelo menos com 0
    const commonKeys = [
      'birthday', 'gender_male', 'gender_female',
      'active_coupon', 'cart_recovered_customer', 'no_purchase_x_days',
      'clicked_campaign', 'abandoned_cart', 'abandoned_cart_products'
    ];
    commonKeys.forEach(key => {
      if (stats[key] === undefined) stats[key] = 0;
    });


    return stats;
  }

  async getContactsBySegments(userId: number, segmentations: (string | SegmentationParam)[], groupIds?: number[]): Promise<Contact[]> {
    const hasSegments = segmentations && segmentations.length > 0;
    const hasGroups = groupIds && groupIds.length > 0;

    if (!hasSegments && !hasGroups) return [];

    const query = this.contactsRepository.createQueryBuilder('contact')
      .leftJoinAndSelect('contact.contactSegmentations', 'cs')
      .leftJoinAndSelect('contact.group', 'group')
      .leftJoinAndSelect('contact.sales', 'sales')
      .leftJoinAndSelect('sales.product', 'product')
      .where('contact.userId = :userId', { userId });

    const orConditions: string[] = [];
    const parameters: any = {};

    const segmentationsToProcess = segmentations || [];
    for (let i = 0; i < segmentationsToProcess.length; i++) {
      const seg = segmentations[i];
      const segId = typeof seg === 'string' ? seg : seg.id;
      const segParams = typeof seg === 'string' ? {} : (seg.params || {});
      const paramName = `seg_${i}`;

      if (segId === 'total') {
        orConditions.push('1=1');
      } else if (segId === 'birthday') {
        const targetMonth = segParams.month !== undefined ? segParams.month : new Date().getMonth() + 1;
        orConditions.push(`EXTRACT(MONTH FROM contact.birthDate) = :${paramName}`);
        parameters[paramName] = targetMonth;
      } else if (segId === 'gender') {
        if (segParams.gender === 'M' || segParams.gender === 'F') {
          orConditions.push(`contact.gender = :${paramName}`);
          parameters[paramName] = segParams.gender;
        } else {
          // Se 'gender' for Ambos ou vazio, não aplicamos filtro de gênero no banco,
          // permitindo que todos os contatos (incluindo NULL) sejam trazidos.
        }
      } else if (segId === 'active_coupon') {
        const now = new Date();
        const subQuery = this.campaignCouponRepository.createQueryBuilder('coupon')
          .select('DISTINCT coupon.contactId')
          .innerJoin('coupon.campaign', 'c')
          .where('coupon.userId = :userId', { userId })
          .andWhere('c.status = :activeStatus', { activeStatus: 'ativa' })
          .andWhere('coupon.endsAt > :nowCoupon', { nowCoupon: now });

        if (segParams.campaignId) {
          subQuery.andWhere('coupon.campaignId = :couponCampaignId', { couponCampaignId: Number(segParams.campaignId) });
        } else if (segParams.couponName) {
          subQuery.andWhere('coupon.name = :couponSearchName', { couponSearchName: segParams.couponName });
        }

        orConditions.push(`contact.id IN (${subQuery.getQuery()})`);
        Object.assign(parameters, subQuery.getParameters());
      } else if (segId === 'lead_captured') {
        orConditions.push(`contact.status = 'lead'`);
      } else if (segId === 'inactive_customers') {
        const days = segParams.days !== undefined ? segParams.days : 90;
        const ninetyDaysAgo = new Date();
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - days);

        const subQuery = this.saleRepository.createQueryBuilder('p')
          .select('p.contactId')
          .where('p.createdAt >= :nineDate', { nineDate: ninetyDaysAgo });

        orConditions.push(`contact.id NOT IN (${subQuery.getQuery()})`);
        Object.assign(parameters, subQuery.getParameters());
      } else if (segId === 'no_purchase_x_days') {
        const days = segParams.days !== undefined ? segParams.days : 30;
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - days);

        const subQuery = this.saleRepository.createQueryBuilder('p')
          .select('p.contactId')
          .where('p.createdAt >= :thirtDate', { thirtDate: thirtyDaysAgo });

        orConditions.push(`contact.id NOT IN (${subQuery.getQuery()})`);
        Object.assign(parameters, subQuery.getParameters());
      } else if (segId === 'by_purchase_count') {
        const minPurchases = segParams.minPurchases !== undefined ? segParams.minPurchases : 1;
        const subQuery = this.saleRepository.createQueryBuilder('p')
          .select('p.contactId')
          .groupBy('p.contactId')
          .having('COUNT(*) >= :minPurchases', { minPurchases });

        orConditions.push(`contact.id IN (${subQuery.getQuery()})`);
        Object.assign(parameters, subQuery.getParameters());
      } else if (segId === 'high_ticket') {
        const minTicket = segParams.minTicket !== undefined ? segParams.minTicket : 500;
        const subQuery = this.saleRepository.createQueryBuilder('p')
          .select('p.contactId')
          .groupBy('p.contactId')
          .having('AVG(p.totalValue) > :minTicket', { minTicket });

        orConditions.push(`contact.id IN (${subQuery.getQuery()})`);
        Object.assign(parameters, subQuery.getParameters());
      } else if (segId === 'by_state' || segId.startsWith('state_')) {
        if (segId.startsWith('state_')) {
          const state = segId.replace('state_', '').toUpperCase();
          orConditions.push(`contact.state = :${paramName}`);
          parameters[paramName] = state;
        } else if (segParams.state) {
          orConditions.push(`contact.state = :${paramName}`);
          parameters[paramName] = segParams.state;
        } else {
          orConditions.push(`contact.state IS NOT NULL`);
        }
      } else if (segId === 'clicked_campaign') {
        const subQuery = this.campaignClickRepository.createQueryBuilder('click')
          .select('DISTINCT click.contactId')
          .where('click.campaignId IN (SELECT id from campaigns where userId = :userId)', { userId });

        orConditions.push(`contact.id IN (${subQuery.getQuery()})`);
        Object.assign(parameters, subQuery.getParameters());
      } else if (segId === 'abandoned_cart') {
        const subQuery = this.saleRepository.createQueryBuilder('sale')
          .select('DISTINCT sale.contactId')
          .where('sale.userId = :userId', { userId })
          .andWhere('sale.status IN (:...statuses)', { statuses: ['pending', 'active_cart', 'abandoned_cart'] });

        orConditions.push(`contact.id IN (${subQuery.getQuery()})`);
        Object.assign(parameters, subQuery.getParameters());
      } else if (segId === 'cart_recovered_customer') {
        const subQuery = this.contactsRepository.createQueryBuilder('c')
          .select('c.id')
          .innerJoin('c.sales', 's1', "s1.status = 'completed'")
          .innerJoin('c.sales', 's2', "s2.status IN ('pending', 'active_cart', 'abandoned_cart') AND s1.createdAt > s2.createdAt")
          .where('c.userId = :userId', { userId });

        orConditions.push(`contact.id IN (${subQuery.getQuery()})`);
        Object.assign(parameters, subQuery.getParameters());
      } else if (segId === 'purchased_product') {
        const productIds = segParams.productIds || [];
        if (productIds.length > 0) {
          const subQuery = this.saleRepository.createQueryBuilder('sale')
            .select('DISTINCT sale.contactId')
            .where('sale.productId IN (:...productIds)', { productIds })
            .andWhere('sale.status = :completedStatus', { completedStatus: 'completed' });

          orConditions.push(`contact.id IN (${subQuery.getQuery()})`);
          Object.assign(parameters, subQuery.getParameters());
        }
      } else if (segId === 'abandoned_cart_products') {
        const productIds = segParams.productIds || [];
        if (productIds.length > 0) {
          const subQuery = this.saleRepository.createQueryBuilder('sale')
            .select('DISTINCT sale.contactId')
            .where('sale.productId IN (:...productIds)', { productIds })
            .andWhere('sale.status IN (:...statuses)', { statuses: ['pending', 'active_cart', 'abandoned_cart'] });

          orConditions.push(`contact.id IN (${subQuery.getQuery()})`);
          Object.assign(parameters, subQuery.getParameters());
        }
      } else {
        // Fallback para segmentações manuais persistidas
        orConditions.push(`cs.segmentationId = :${paramName}`);
        parameters[paramName] = segId;
      }
    }

    if (hasGroups) {
      orConditions.push(`contact.groupId IN (:...groupIds)`);
      parameters['groupIds'] = groupIds;
    }

    if (orConditions.length > 0) {
      query.andWhere(`(${orConditions.join(' OR ')})`, parameters);
    }

    return query.getMany();
  }
}

