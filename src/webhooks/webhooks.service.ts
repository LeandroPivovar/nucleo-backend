import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { WebhookLog } from '../entities/webhook-log.entity';

// Retenção dos logs de webhook: payloads carregam PII (nome, e-mail, telefone,
// endereço) de clientes das lojas — manter apenas o necessário para depuração.
const WEBHOOK_LOG_RETENTION_DAYS = 30;

// Headers que nunca devem ser persistidos (tokens/segredos de autenticação).
const SENSITIVE_HEADERS = ['authorization', 'cookie', 'asaas-access-token', 'x-api-key'];

@Injectable()
export class WebhooksService {
    private readonly logger = new Logger(WebhooksService.name);

    constructor(
        @InjectRepository(WebhookLog)
        private readonly webhookLogRepository: Repository<WebhookLog>,
    ) { }

    async logWebhook(
        url: string,
        method: string,
        headers: any,
        payload: any,
        source?: string,
        userId?: number | null,
    ): Promise<WebhookLog> {
        // Redação centralizada: nenhum caller consegue persistir segredos por engano.
        const safeHeaders = { ...(headers || {}) };
        for (const key of SENSITIVE_HEADERS) {
            if (safeHeaders[key] !== undefined) safeHeaders[key] = '[REDACTED]';
        }

        const log = this.webhookLogRepository.create({
            url,
            method,
            headers: safeHeaders,
            payload,
            source,
            userId: userId ?? null,
        });
        return this.webhookLogRepository.save(log);
    }

    /**
     * Admin enxerga todos os logs; usuário comum apenas os logs atribuídos a ele.
     * Logs sem dono (userId null) só aparecem para admin — podem conter dados
     * de qualquer origem e não devem vazar entre tenants.
     */
    async findAllForUser(userId: number, isAdmin: boolean): Promise<WebhookLog[]> {
        return this.webhookLogRepository.find({
            where: isAdmin ? {} : { userId },
            order: { createdAt: 'DESC' },
            take: 500,
        });
    }

    async findOneForUser(id: number, userId: number, isAdmin: boolean): Promise<WebhookLog> {
        const log = await this.webhookLogRepository.findOne({ where: { id } });
        if (!log || (!isAdmin && log.userId !== userId)) {
            throw new NotFoundException('Log de webhook não encontrado');
        }
        return log;
    }

    @Cron(CronExpression.EVERY_DAY_AT_3AM)
    async purgeOldLogs(): Promise<void> {
        const cutoff = new Date(Date.now() - WEBHOOK_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
        const result = await this.webhookLogRepository.delete({ createdAt: LessThan(cutoff) });
        if (result.affected) {
            this.logger.log(`Purge de logs de webhook: ${result.affected} registro(s) com mais de ${WEBHOOK_LOG_RETENTION_DAYS} dias removido(s).`);
        }
    }
}
