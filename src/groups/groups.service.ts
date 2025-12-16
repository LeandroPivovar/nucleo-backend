import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Group } from '../entities/group.entity';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';

@Injectable()
export class GroupsService {
  constructor(
    @InjectRepository(Group)
    private groupsRepository: Repository<Group>,
  ) {}

  async create(userId: number, createGroupDto: CreateGroupDto): Promise<Group> {
    const group = this.groupsRepository.create({
      ...createGroupDto,
      userId,
    });
    return this.groupsRepository.save(group);
  }

  async findAll(userId: number): Promise<Group[]> {
    return this.groupsRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(userId: number, id: number): Promise<Group> {
    const group = await this.groupsRepository.findOne({
      where: { id, userId },
    });

    if (!group) {
      throw new NotFoundException(`Grupo com ID ${id} não encontrado`);
    }

    return group;
  }

  async update(
    userId: number,
    id: number,
    updateGroupDto: UpdateGroupDto,
  ): Promise<Group> {
    const group = await this.findOne(userId, id);
    Object.assign(group, updateGroupDto);
    return this.groupsRepository.save(group);
  }

  async remove(userId: number, id: number): Promise<void> {
    const group = await this.findOne(userId, id);
    await this.groupsRepository.remove(group);
  }
}

