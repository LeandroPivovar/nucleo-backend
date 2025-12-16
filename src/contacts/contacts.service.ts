import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Contact } from '../entities/contact.entity';
import { ContactTag } from '../entities/contact-tag.entity';
import { ContactSegmentation } from '../entities/contact-segmentation.entity';
import { Tag } from '../entities/tag.entity';
import { Group } from '../entities/group.entity';
import { CreateContactDto } from './dto/create-contact.dto';
import { UpdateContactDto } from './dto/update-contact.dto';
import { ImportContactRow } from './dto/import-contacts.dto';

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
  ) {}

  async create(userId: number, createContactDto: CreateContactDto): Promise<Contact> {
    const { tagIds, groupId, segmentationIds, ...contactData } = createContactDto;

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
      groupId: groupId ?? null,
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

    // Salvar segmentações se fornecidas
    if (segmentationIds && segmentationIds.length > 0) {
      const contactSegmentations = segmentationIds.map(segmentationId =>
        this.contactSegmentationsRepository.create({
          contactId: savedContact.id,
          segmentationId,
        }),
      );
      await this.contactSegmentationsRepository.save(contactSegmentations);
    }

    // Retornar contato com relações carregadas
    return this.findOne(userId, savedContact.id);
  }

  async findAll(userId: number): Promise<Contact[]> {
    return this.contactsRepository.find({
      where: { userId },
      relations: ['contactTags', 'contactTags.tag', 'contactSegmentations', 'group'],
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(userId: number, id: number): Promise<Contact> {
    const contact = await this.contactsRepository.findOne({
      where: { id, userId },
      relations: ['contactTags', 'contactTags.tag', 'contactSegmentations', 'group'],
    });

    if (!contact) {
      throw new NotFoundException(`Contato com ID ${id} não encontrado`);
    }

    return contact;
  }

  async update(
    userId: number,
    id: number,
    updateContactDto: UpdateContactDto,
  ): Promise<Contact> {
    const { tagIds, groupId, segmentationIds, ...contactData } = updateContactDto;
    const contact = await this.findOne(userId, id);

    // Atualizar grupo se fornecido
    if (groupId !== undefined) {
      if (groupId === null) {
        contact.groupId = null;
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

    // Atualizar segmentações se fornecidas
    if (segmentationIds !== undefined) {
      // Remover segmentações existentes
      await this.contactSegmentationsRepository.delete({ contactId: id });

      // Adicionar novas segmentações
      if (segmentationIds.length > 0) {
        const contactSegmentations = segmentationIds.map(segmentationId =>
          this.contactSegmentationsRepository.create({
            contactId: id,
            segmentationId,
          }),
        );
        await this.contactSegmentationsRepository.save(contactSegmentations);
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
          groupId,
          tagIds: tagIds.length > 0 ? tagIds : undefined,
          segmentationIds: segmentationIds.length > 0 ? segmentationIds : undefined,
        };

        await this.create(userId, createDto);
        created++;
      } catch (error) {
        errors.push(`Linha ${lineNumber}: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
      }
    }

    return { created, errors };
  }
}

