import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EmailConnection } from '../entities/email-connection.entity';
import { CreateEmailConnectionDto } from './dto/create-email-connection.dto';

type EmailConnectionResponse = Omit<EmailConnection, 'password'>;

@Injectable()
export class EmailConnectionsService {
  constructor(
    @InjectRepository(EmailConnection)
    private readonly emailConnectionRepository: Repository<EmailConnection>,
  ) {}

  private sanitize(connection: EmailConnection): EmailConnectionResponse {
    const { password: _password, ...rest } = connection;
    return rest;
  }

  async create(userId: number, dto: CreateEmailConnectionDto): Promise<EmailConnectionResponse> {
    const secure = dto.secure ?? dto.smtpPort === 465;

    const connection = this.emailConnectionRepository.create({
      ...dto,
      secure,
      userId,
    });

    const saved = await this.emailConnectionRepository.save(connection);
    return this.sanitize(saved);
  }

  async findAll(userId: number): Promise<EmailConnectionResponse[]> {
    const connections = await this.emailConnectionRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });

    return connections.map((connection) => this.sanitize(connection));
  }

  async findOne(id: number, userId: number): Promise<EmailConnectionResponse> {
    const connection = await this.emailConnectionRepository.findOne({
      where: { id, userId },
    });

    if (!connection) {
      throw new NotFoundException('Conexão de e-mail não encontrada');
    }

    return this.sanitize(connection);
  }

  async remove(id: number, userId: number): Promise<void> {
    const connection = await this.emailConnectionRepository.findOne({
      where: { id, userId },
    });

    if (!connection) {
      throw new NotFoundException('Conexão de e-mail não encontrada');
    }

    await this.emailConnectionRepository.remove(connection);
  }
}


