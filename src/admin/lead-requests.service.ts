import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LeadRequest, LeadStatus } from '../entities/lead-request.entity';

@Injectable()
export class LeadRequestsService {
  constructor(
    @InjectRepository(LeadRequest)
    private leadRequestRepository: Repository<LeadRequest>,
  ) {}

  async create(data: Partial<LeadRequest>): Promise<LeadRequest> {
    const lead = this.leadRequestRepository.create({
      ...data,
      status: LeadStatus.PENDING,
    });
    return this.leadRequestRepository.save(lead);
  }

  async findAll(): Promise<LeadRequest[]> {
    return this.leadRequestRepository.find({
      order: { createdAt: 'DESC' },
    });
  }

  async updateStatus(id: number, status: LeadStatus): Promise<LeadRequest> {
    const lead = await this.leadRequestRepository.findOne({ where: { id } });
    if (!lead) {
      throw new NotFoundException(`Solicitação ${id} não encontrada`);
    }
    lead.status = status;
    return this.leadRequestRepository.save(lead);
  }

  async findOne(id: number): Promise<LeadRequest> {
    const lead = await this.leadRequestRepository.findOne({ where: { id } });
    if (!lead) {
      throw new NotFoundException(`Solicitação ${id} não encontrada`);
    }
    return lead;
  }
}
