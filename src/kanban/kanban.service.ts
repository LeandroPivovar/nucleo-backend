import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { KanbanColumn } from '../entities/kanban-column.entity';
import { KanbanCard } from '../entities/kanban-card.entity';
import { User } from '../entities/user.entity';

@Injectable()
export class KanbanService {
    private readonly logger = new Logger(KanbanService.name);

    constructor(
        @InjectRepository(KanbanColumn)
        private readonly columnRepo: Repository<KanbanColumn>,
        @InjectRepository(KanbanCard)
        private readonly cardRepo: Repository<KanbanCard>,
        @InjectRepository(User)
        private readonly userRepo: Repository<User>,
    ) { }

    // --- Columns ---

    async getColumns(userId: number) {
        this.logger.log(`[getColumns] userId=${userId}`);
        const columns = await this.columnRepo.find({
            where: { userId },
            order: { order: 'ASC', createdAt: 'ASC' },
        });
        this.logger.log(`[getColumns] userId=${userId} → ${columns.length} colunas encontradas`);
        return columns;
    }

    async createColumn(userId: number, data: { name: string; description?: string }) {
        this.logger.log(`[createColumn] userId=${userId} name="${data.name}"`);
        const maxOrder = await this.columnRepo
            .createQueryBuilder('c')
            .where('c.userId = :userId', { userId })
            .orderBy('c.order', 'DESC')
            .getOne();

        const column = this.columnRepo.create({
            userId,
            name: data.name,
            description: data.description || '',
            order: (maxOrder?.order ?? -1) + 1,
        });
        const saved = await this.columnRepo.save(column);
        this.logger.log(`[createColumn] Coluna criada id=${saved.id} name="${saved.name}" order=${saved.order}`);
        return saved;
    }

    async updateColumn(userId: number, columnId: number, data: { name?: string; description?: string; order?: number; active?: boolean }) {
        this.logger.log(`[updateColumn] userId=${userId} columnId=${columnId} data=${JSON.stringify(data)}`);
        const column = await this.columnRepo.findOne({ where: { id: columnId, userId } });
        if (!column) {
            this.logger.warn(`[updateColumn] Coluna id=${columnId} não encontrada para userId=${userId}`);
            throw new NotFoundException('Coluna não encontrada');
        }
        Object.assign(column, data);
        const saved = await this.columnRepo.save(column);
        this.logger.log(`[updateColumn] Coluna id=${saved.id} atualizada`);
        return saved;
    }

    async deleteColumn(userId: number, columnId: number) {
        this.logger.log(`[deleteColumn] userId=${userId} columnId=${columnId}`);
        const column = await this.columnRepo.findOne({ where: { id: columnId, userId } });
        if (!column) {
            this.logger.warn(`[deleteColumn] Coluna id=${columnId} não encontrada para userId=${userId}`);
            throw new NotFoundException('Coluna não encontrada');
        }
        await this.columnRepo.remove(column);
        this.logger.log(`[deleteColumn] Coluna id=${columnId} removida`);
        return { success: true };
    }

    // --- Cards ---

    async getCards(userId: number, columnId?: number) {
        this.logger.log(`[getCards] userId=${userId} columnId=${columnId ?? 'todos'}`);
        const where: any = { userId };
        if (columnId) where.columnId = columnId;

        const cards = await this.cardRepo.find({
            where,
            order: { order: 'ASC', createdAt: 'ASC' },
        });
        this.logger.log(`[getCards] userId=${userId} → ${cards.length} cards encontrados`);
        return cards;
    }

    async createCard(userId: number, data: { columnId: number; title: string; description?: string; metadata?: Record<string, any> }) {
        this.logger.log(`[createCard] userId=${userId} columnId=${data.columnId} title="${data.title}"`);
        const column = await this.columnRepo.findOne({ where: { id: data.columnId, userId } });
        if (!column) {
            this.logger.warn(`[createCard] Coluna id=${data.columnId} não encontrada para userId=${userId}`);
            throw new NotFoundException('Coluna não encontrada');
        }

        const maxOrder = await this.cardRepo
            .createQueryBuilder('card')
            .where('card.columnId = :columnId', { columnId: data.columnId })
            .orderBy('card.order', 'DESC')
            .getOne();

        const card = this.cardRepo.create({
            userId,
            columnId: data.columnId,
            title: data.title,
            description: data.description || undefined,
            order: (maxOrder?.order ?? -1) + 1,
            metadata: data.metadata || undefined,
        });
        const saved = await this.cardRepo.save(card);
        this.logger.log(`[createCard] Card criado id=${saved.id} title="${saved.title}" order=${saved.order}`);
        return saved;
    }

    async updateCard(userId: number, cardId: number, data: { title?: string; description?: string; columnId?: number; order?: number; active?: boolean; metadata?: Record<string, any> }) {
        this.logger.log(`[updateCard] userId=${userId} cardId=${cardId} data=${JSON.stringify(data)}`);
        const card = await this.cardRepo.findOne({ where: { id: cardId, userId } });
        if (!card) {
            this.logger.warn(`[updateCard] Card id=${cardId} não encontrado para userId=${userId}`);
            throw new NotFoundException('Card não encontrado');
        }

        if (data.columnId) {
            const column = await this.columnRepo.findOne({ where: { id: data.columnId, userId } });
            if (!column) throw new NotFoundException('Coluna de destino não encontrada');
        }

        Object.assign(card, data);
        const saved = await this.cardRepo.save(card);
        this.logger.log(`[updateCard] Card id=${saved.id} atualizado`);
        return saved;
    }

    async deleteCard(userId: number, cardId: number) {
        this.logger.log(`[deleteCard] userId=${userId} cardId=${cardId}`);
        const card = await this.cardRepo.findOne({ where: { id: cardId, userId } });
        if (!card) {
            this.logger.warn(`[deleteCard] Card id=${cardId} não encontrado para userId=${userId}`);
            throw new NotFoundException('Card não encontrado');
        }
        await this.cardRepo.remove(card);
        this.logger.log(`[deleteCard] Card id=${cardId} removido`);
        return { success: true };
    }

    async moveCard(userId: number, cardId: number, toColumnId: number, newOrder?: number) {
        this.logger.log(`[moveCard] userId=${userId} cardId=${cardId} → columnId=${toColumnId} order=${newOrder}`);
        const card = await this.cardRepo.findOne({ where: { id: cardId, userId } });
        if (!card) throw new NotFoundException('Card não encontrado');

        const column = await this.columnRepo.findOne({ where: { id: toColumnId, userId } });
        if (!column) throw new NotFoundException('Coluna de destino não encontrada');

        card.columnId = toColumnId;
        if (newOrder !== undefined) card.order = newOrder;
        const saved = await this.cardRepo.save(card);
        this.logger.log(`[moveCard] Card id=${cardId} movido para coluna id=${toColumnId}`);
        return saved;
    }

    async reorderColumn(userId: number, updates: { columnId: number; order: number }[]) {
        this.logger.log(`[reorderColumn] userId=${userId} updates=${JSON.stringify(updates)}`);
        await Promise.all(
            updates.map((u) =>
                this.columnRepo.update({ id: u.columnId, userId }, { order: u.order }),
            ),
        );
        return { success: true };
    }

    async reorderCard(userId: number, updates: { cardId: number; columnId: number; order: number }[]) {
        this.logger.log(`[reorderCard] userId=${userId} updates=${JSON.stringify(updates)}`);
        await Promise.all(
            updates.map((u) =>
                this.cardRepo.update({ id: u.cardId, userId }, { columnId: u.columnId, order: u.order }),
            ),
        );
        return { success: true };
    }
}
