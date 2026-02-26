import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WebhookLog } from '../entities/webhook-log.entity';

@Injectable()
export class WebhooksService {
    constructor(
        @InjectRepository(WebhookLog)
        private readonly webhookLogRepository: Repository<WebhookLog>,
    ) { }

    async logWebhook(url: string, method: string, headers: any, payload: any, source?: string): Promise<WebhookLog> {
        const log = this.webhookLogRepository.create({
            url,
            method,
            headers,
            payload,
            source,
        });
        return this.webhookLogRepository.save(log);
    }

    async findAll(): Promise<WebhookLog[]> {
        return this.webhookLogRepository.find({
            order: { createdAt: 'DESC' },
        });
    }

    async findOne(id: number): Promise<WebhookLog | null> {
        return this.webhookLogRepository.findOne({ where: { id } });
    }
}
