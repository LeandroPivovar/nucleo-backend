import { Injectable, NotFoundException, BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EmailTemplate } from '../entities/email-template.entity';
import { EmailConnection } from '../entities/email-connection.entity';
import { EmailService } from '../email/email.service';
import { SmtpEmailService } from '../email/smtp-email.service';

export enum EmailTemplateCategory {
  TRANSACTIONAL = 'transactional',
  MARKETING = 'marketing',
  NOTIFICATION = 'notification',
  CUSTOM = 'custom',
}

@Injectable()
export class EmailTemplatesService {
    constructor(
      @InjectRepository(EmailTemplate)
      private readonly templateRepo: Repository<EmailTemplate>,
      @InjectRepository(EmailConnection)
      private readonly connectionRepo: Repository<EmailConnection>,
      private readonly emailService: EmailService,
      private readonly smtpEmailService: SmtpEmailService,
      private readonly logger: Logger,
    ) {}

  // ========== CRUD ==========

  async getTemplates(userId: number): Promise<EmailTemplate[]> {
    return this.templateRepo.find({
      where: { userId },
      order: { updatedAt: 'DESC' },
    });
  }

  async getTemplate(userId: number, templateId: number): Promise<EmailTemplate> {
    const template = await this.templateRepo.findOne({ where: { id: templateId, userId } });
    if (!template) throw new NotFoundException('Template não encontrado');
    return template;
  }

  async createTemplate(
    userId: number,
    data: { name: string; subject?: string; html: string; category?: EmailTemplateCategory; description?: string },
  ): Promise<EmailTemplate> {
    if (!data.name?.trim() || !data.html?.trim()) {
      throw new BadRequestException('Nome e conteúdo HTML são obrigatórios');
    }
    const template = this.templateRepo.create({
      userId,
      name: data.name.trim(),
      subject: data.subject?.trim() || '',
      html: data.html,
      category: data.category || EmailTemplateCategory.CUSTOM,
      description: data.description?.trim() || undefined,
    });
    return this.templateRepo.save(template);
  }

  async updateTemplate(
    userId: number,
    templateId: number,
    data: { name?: string; subject?: string; html?: string; category?: EmailTemplateCategory; active?: boolean; description?: string },
  ): Promise<EmailTemplate> {
    const template = await this.getTemplate(userId, templateId);
    if (data.name !== undefined) template.name = data.name.trim();
    if (data.subject !== undefined) template.subject = data.subject.trim();
    if (data.html !== undefined) template.html = data.html;
    if (data.category !== undefined) template.category = data.category;
    if (data.active !== undefined) template.active = data.active;
    if (data.description !== undefined) template.description = data.description.trim();
    return this.templateRepo.save(template);
  }

  async deleteTemplate(userId: number, templateId: number): Promise<{ success: boolean }> {
    const template = await this.getTemplate(userId, templateId);
    await this.templateRepo.remove(template);
    return { success: true };
  }

  // ========== SEND ==========

  async sendTemplate(
    userId: number,
    data: {
      templateId: number;
      to: string | string[];
      subject?: string;
      connectionId?: number;
      variables?: Record<string, string>;
    },
  ): Promise<{ success: boolean; messageId?: string }> {
    this.logger.log(`[EmailTemplates] Iniciando envio userId=${userId} templateId=${data.templateId} connectionId=${data.connectionId ?? 'auto'}`);
    const template = await this.getTemplate(userId, data.templateId);
    if (!template.active) throw new BadRequestException('Este template está inativo');

    let connection: EmailConnection | null = null;

    if (data.connectionId) {
      this.logger.log(`[EmailTemplates] Buscando conexão id=${data.connectionId}`);
      connection = await this.connectionRepo.findOne({ where: { id: data.connectionId, userId } });
      if (!connection) throw new NotFoundException('Conexão de e-mail não encontrada');
      if (connection.status !== 'verified') throw new BadRequestException('Conexão de e-mail não está verificada');
    } else {
      this.logger.log(`[EmailTemplates] Buscando conexão padrão para userId=${userId}`);
      connection = await this.connectionRepo.findOne({
        where: { userId, status: 'verified' },
        order: { updatedAt: 'DESC' },
      });
      if (!connection) {
        this.logger.warn(`[EmailTemplates] Nenhuma conexão verificada para userId=${userId}`);
        throw new BadRequestException('Nenhuma conexão de e-mail verificada encontrada. Configure uma conexão em Conexões > E-mail.');
      }
      this.logger.log(`[EmailTemplates] Usando conexão padrão id=${connection.id} type=${connection.type}`);
    }

    let html = template.html;
    if (data.variables && Object.keys(data.variables).length > 0) {
      Object.entries(data.variables).forEach(([key, value]) => {
        const regex = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'gi');
        html = html.replace(regex, value);
      });
    }

    const subject = data.subject || template.subject || 'Sem assunto';

    this.logger.log(`[EmailTemplates] Enviando para=${Array.isArray(data.to) ? data.to.join(',') : data.to} subject="${subject}" via conexão id=${connection.id}`);
    if (connection.type === 'smtp') {
      this.logger.log(`[EmailTemplates] Usando SMTP ${connection.smtpHost}:${connection.smtpPort}`);
      const result = await this.smtpEmailService.sendEmail(connection, {
        to: data.to,
        subject,
        html,
      });
      return { success: true, messageId: result.messageId };
    } else {
      this.logger.log(`[EmailTemplates] Usando Zenvia (domain)`);
      await this.emailService.sendEmail({
        to: data.to,
        subject,
        html,
      });
      return { success: true };
    }
  }
}
