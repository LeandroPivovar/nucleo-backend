import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BotFlow } from '../entities/bot-flow.entity';
import { SaveBotFlowDto } from './dto/save-bot-flow.dto';
import { CreateBotFlowDto } from './dto/create-bot-flow.dto';
import { UpdateBotFlowDto } from './dto/update-bot-flow.dto';
import type { BotFlowChannel } from './bot-flow-channel';

export interface BotFlowListItem {
  id: number;
  name: string;
  channel: BotFlowChannel;
  isActive: boolean;
  nodeCount: number;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class BotFlowsService {
  constructor(
    @InjectRepository(BotFlow)
    private readonly botFlowRepository: Repository<BotFlow>,
  ) {}

  private async findOneOrFail(userId: number, id: number): Promise<BotFlow> {
    const flow = await this.botFlowRepository.findOne({
      where: { id, userId },
    });
    if (!flow) {
      throw new NotFoundException(`Fluxo com ID ${id} não encontrado`);
    }
    return flow;
  }

  private getNodeCount(nodes: unknown): number {
    if (Array.isArray(nodes)) return nodes.length;
    if (typeof nodes === 'string') {
      try {
        const parsed = JSON.parse(nodes);
        return Array.isArray(parsed) ? parsed.length : 0;
      } catch {
        return 0;
      }
    }
    return 0;
  }

  async findAll(userId: number): Promise<BotFlowListItem[]> {
    const flows = await this.botFlowRepository.find({
      where: { userId },
      order: { updatedAt: 'DESC' },
    });

    return flows.map((flow) => ({
      id: flow.id,
      name: flow.name,
      channel: flow.channel,
      isActive: flow.isActive,
      nodeCount: this.getNodeCount(flow.nodes),
      createdAt: flow.createdAt,
      updatedAt: flow.updatedAt,
    }));
  }

  async findOne(userId: number, id: number): Promise<BotFlow> {
    return this.findOneOrFail(userId, id);
  }

  async create(userId: number, dto: CreateBotFlowDto): Promise<BotFlow> {
    const flow = this.botFlowRepository.create({
      userId,
      name: dto.name.trim(),
      channel: dto.channel as BotFlowChannel,
      nodes: [],
      edges: [],
      isActive: false,
    });
    return this.botFlowRepository.save(flow);
  }

  async updateMeta(userId: number, id: number, dto: UpdateBotFlowDto): Promise<BotFlow> {
    const flow = await this.findOneOrFail(userId, id);
    if (dto.name !== undefined) flow.name = dto.name.trim();
    if (dto.isActive !== undefined) flow.isActive = dto.isActive;
    return this.botFlowRepository.save(flow);
  }

  async saveFlow(userId: number, id: number, dto: SaveBotFlowDto): Promise<BotFlow> {
    const flow = await this.findOneOrFail(userId, id);
    flow.nodes = dto.nodes;
    flow.edges = dto.edges;
    if (dto.isActive !== undefined) {
      flow.isActive = dto.isActive;
    }
    return this.botFlowRepository.save(flow);
  }

  async remove(userId: number, id: number): Promise<void> {
    const flow = await this.findOneOrFail(userId, id);
    await this.botFlowRepository.remove(flow);
  }
}
