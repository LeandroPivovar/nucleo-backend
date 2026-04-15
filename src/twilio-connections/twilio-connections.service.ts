import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TwilioConnection } from '../entities/twilio-connection.entity';
import { TwilioService } from '../twilio/twilio.service';

@Injectable()
export class TwilioConnectionsService {
  constructor(
    @InjectRepository(TwilioConnection)
    private readonly twilioConnectionRepository: Repository<TwilioConnection>,
    private readonly twilioService: TwilioService,
  ) { }

  async createRequest(userId: number, dto: { friendlyName?: string; whatsappFrom: string }): Promise<TwilioConnection> {
    const request = this.twilioConnectionRepository.create({
      userId,
      friendlyName: dto.friendlyName,
      whatsappFrom: dto.whatsappFrom,
      status: 'pending',
    });
    return this.twilioConnectionRepository.save(request);
  }

  async findMyRequests(userId: number): Promise<TwilioConnection[]> {
    return this.twilioConnectionRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: number, userId: number): Promise<TwilioConnection> {
    const connection = await this.twilioConnectionRepository.findOne({
      where: { id, userId },
    });
    if (!connection) throw new NotFoundException('Solicitação não encontrada');
    return connection;
  }

  async remove(id: number, userId: number): Promise<void> {
    const connection = await this.findOne(id, userId);
    await this.twilioConnectionRepository.remove(connection);
  }

  // Admin methods
  async findAllPending(): Promise<TwilioConnection[]> {
    return this.twilioConnectionRepository.find({
      where: { status: 'pending' },
      relations: ['user'],
      order: { createdAt: 'ASC' },
    });
  }

  async approve(id: number, credentials: { accountSid: string; authToken: string }): Promise<TwilioConnection> {
    const connection = await this.twilioConnectionRepository.findOne({ where: { id } });
    if (!connection) throw new NotFoundException('Solicitação não encontrada');

    connection.status = 'verified';
    connection.accountSid = credentials.accountSid;
    connection.authToken = this.twilioService.encryptAuthToken(credentials.authToken);
    
    return this.twilioConnectionRepository.save(connection);
  }

  async reject(id: number, adminNote: string): Promise<TwilioConnection> {
    const connection = await this.twilioConnectionRepository.findOne({ where: { id } });
    if (!connection) throw new NotFoundException('Solicitação não encontrada');

    connection.status = 'rejected';
    connection.adminNote = adminNote;
    
    return this.twilioConnectionRepository.save(connection);
  }

  async getVerifiedConnection(userId: number): Promise<TwilioConnection | null> {
    return this.twilioConnectionRepository.findOne({
      where: { userId, status: 'verified' },
      select: ['id', 'accountSid', 'authToken', 'whatsappFrom', 'status'],
    });
  }
}
