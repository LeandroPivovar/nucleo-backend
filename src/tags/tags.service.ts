import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tag } from '../entities/tag.entity';
import { CreateTagDto } from './dto/create-tag.dto';
import { UpdateTagDto } from './dto/update-tag.dto';

@Injectable()
export class TagsService {
  constructor(
    @InjectRepository(Tag)
    private tagsRepository: Repository<Tag>,
  ) {}

  async create(userId: number, createTagDto: CreateTagDto): Promise<Tag> {
    const tag = this.tagsRepository.create({
      ...createTagDto,
      userId,
    });
    return this.tagsRepository.save(tag);
  }

  async findAll(userId: number): Promise<Tag[]> {
    return this.tagsRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(userId: number, id: number): Promise<Tag> {
    const tag = await this.tagsRepository.findOne({
      where: { id, userId },
    });

    if (!tag) {
      throw new NotFoundException(`Etiqueta com ID ${id} não encontrada`);
    }

    return tag;
  }

  async update(
    userId: number,
    id: number,
    updateTagDto: UpdateTagDto,
  ): Promise<Tag> {
    const tag = await this.findOne(userId, id);
    Object.assign(tag, updateTagDto);
    return this.tagsRepository.save(tag);
  }

  async remove(userId: number, id: number): Promise<void> {
    const tag = await this.findOne(userId, id);
    await this.tagsRepository.remove(tag);
  }
}

