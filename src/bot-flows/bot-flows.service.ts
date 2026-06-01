import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BotFlow } from '../entities/bot-flow.entity';
import { SaveBotFlowDto } from './dto/save-bot-flow.dto';

@Injectable()
export class BotFlowsService {
  constructor(
    @InjectRepository(BotFlow)
    private readonly botFlowRepository: Repository<BotFlow>,
  ) {}

  async getFlow(userId: number): Promise<BotFlow | null> {
    return this.botFlowRepository.findOne({
      where: { userId },
    });
  }

  async saveFlow(userId: number, dto: SaveBotFlowDto): Promise<BotFlow> {
    let flow = await this.getFlow(userId);

    if (!flow) {
      flow = this.botFlowRepository.create({
        userId,
        nodes: dto.nodes,
        edges: dto.edges,
        isActive: dto.isActive !== undefined ? dto.isActive : false,
      });
    } else {
      flow.nodes = dto.nodes;
      flow.edges = dto.edges;
      if (dto.isActive !== undefined) {
        flow.isActive = dto.isActive;
      }
    }

    return this.botFlowRepository.save(flow);
  }
}
