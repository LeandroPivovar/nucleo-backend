import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EmailConnection } from '../entities/email-connection.entity';
import { CreateEmailConnectionDto, UpdateEmailConnectionDto } from './dto/create-email-connection.dto';

type EmailConnectionResponse = Omit<EmailConnection, 'password'>;

@Injectable()
export class EmailConnectionsService {
  constructor(
    @InjectRepository(EmailConnection)
    private readonly emailConnectionRepository: Repository<EmailConnection>,
  ) { }

  private sanitize(connection: EmailConnection): EmailConnectionResponse {
    const { password: _password, ...rest } = connection;
    return rest;
  }

  private normalizeDomain(domain: string): string {
    return String(domain || '')
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/^@+/, '')
      .replace(/\/.*$/, '')
      .replace(/\.$/, '');
  }

  private normalizeEmail(email: string): string {
    return String(email || '').trim().toLowerCase();
  }

  private validateSenderDomain(email: string, domain: string): void {
    const senderDomain = email.split('@')[1] || '';
    const belongsToDomain = senderDomain === domain || senderDomain.endsWith(`.${domain}`);

    if (!belongsToDomain) {
      throw new BadRequestException(`O remetente deve pertencer ao domínio ${domain}.`);
    }
  }

  async create(userId: number, dto: CreateEmailConnectionDto): Promise<EmailConnectionResponse> {
    const domain = this.normalizeDomain(dto.domain);
    const email = this.normalizeEmail(dto.email);

    if (!domain || !domain.includes('.') || domain.includes('@')) {
      throw new BadRequestException('Informe apenas o domínio, por exemplo: empresa.com.br');
    }

    this.validateSenderDomain(email, domain);

    const existing = await this.emailConnectionRepository.findOne({
      where: [
        { userId, domain },
        { userId, email },
      ],
    });
    if (existing) {
      throw new BadRequestException('Este domínio ou endereço remetente já está cadastrado.');
    }

    const connectionData: any = {
      type: 'domain',
      status: 'pending',
      userId,
      domain,
      email,
      senderName: dto.senderName?.trim() || null,
      verifiedAt: null,
      dnsTxt: 'TXT/DMARC: cadastre o domínio na Zenvia e copie o registro TXT gerado especificamente para este domínio.',
      dnsCname: 'CNAME: a Zenvia gera 5 registros CNAME específicos por domínio. Copie exatamente os nomes e valores exibidos no painel da Zenvia.',
      dnsMx: 'MX: não use mxa.nucleocrm.com.br. Mantenha o MX do provedor de caixa postal, salvo orientação explícita da Zenvia.',
    };

    const connection = this.emailConnectionRepository.create(connectionData as Partial<EmailConnection>);

    const saved = await this.emailConnectionRepository.save(connection);
    return this.sanitize(saved as EmailConnection);
  }

  async update(
    id: number,
    userId: number,
    dto: UpdateEmailConnectionDto,
  ): Promise<EmailConnectionResponse> {
    const connection = await this.emailConnectionRepository.findOne({
      where: { id, userId },
    });

    if (!connection) {
      throw new NotFoundException('Conexão de e-mail não encontrada');
    }

    const email = this.normalizeEmail(dto.email);
    this.validateSenderDomain(email, connection.domain);

    const duplicate = await this.emailConnectionRepository.findOne({
      where: { userId, email },
    });
    if (duplicate && duplicate.id !== connection.id) {
      throw new BadRequestException('Este endereço remetente já está cadastrado.');
    }

    const senderChanged = connection.email !== email || connection.senderName !== (dto.senderName?.trim() || null);
    connection.email = email;
    connection.senderName = dto.senderName?.trim() || null;

    if (senderChanged) {
      connection.status = 'pending';
      connection.verifiedAt = null;
      connection.adminNote = 'Remetente alterado. É necessário validar novamente na Zenvia.';
    }

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
