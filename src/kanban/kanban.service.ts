import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { KanbanColumn } from '../entities/kanban-column.entity';
import { KanbanCard } from '../entities/kanban-card.entity';
import { User } from '../entities/user.entity';

@Injectable()
export class KanbanService {
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
        return this.columnRepo.find({
            where: { userId },
            order: { order: 'ASC', createdAt: 'ASC' },
        });
    }

    async createColumn(userId: number, data: { name: string; description?: string }) {
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
        return this.columnRepo.save(column);
    }

    async updateColumn(userId: number, columnId: number, data: { name?: string; description?: string; order?: number; active?: boolean }) {
        const column = await this.columnRepo.findOne({ where: { id: columnId, userId } });
        if (!column) throw new NotFoundException('Coluna não encontrada');

        Object.assign(column, data);
        return this.columnRepo.save(column);
    }

    async deleteColumn(userId: number, columnId: number) {
        const column = await this.columnRepo.findOne({ where: { id: columnId, userId } });
        if (!column) throw new NotFoundException('Coluna não encontrada');

        await this.columnRepo.remove(column);
        return { success: true };
    }

    // --- Cards ---

    async getCards(userId: number, columnId?: number) {
        const where: any = { userId };
        if (columnId) where.columnId = columnId;

        return this.cardRepo.find({
            where,
            order: { order: 'ASC', createdAt: 'ASC' },
        });
    }

    async createCard(userId: number, data: { columnId: number; title: string; description?: string; metadata?: Record<string, any> }) {
        const column = await this.columnRepo.findOne({ where: { id: data.columnId, userId } });
        if (!column) throw new NotFoundException('Coluna não encontrada');

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
        return this.cardRepo.save(card);
    }

    async updateCard(userId: number, cardId: number, data: { title?: string; description?: string; columnId?: number; order?: number; active?: boolean; metadata?: Record<string, any> }) {
        const card = await this.cardRepo.findOne({ where: { id: cardId, userId } });
        if (!card) throw new NotFoundException('Card não encontrado');

        if (data.columnId) {
            const column = await this.columnRepo.findOne({ where: { id: data.columnId, userId } });
            if (!column) throw new NotFoundException('Coluna de destino não encontrada');
        }

        Object.assign(card, data);
        return this.cardRepo.save(card);
    }

    async deleteCard(userId: number, cardId: number) {
        const card = await this.cardRepo.findOne({ where: { id: cardId, userId } });
        if (!card) throw new NotFoundException('Card não encontrado');

        await this.cardRepo.remove(card);
        return { success: true };
    }

    async moveCard(userId: number, cardId: number, toColumnId: number, newOrder?: number) {
        const card = await this.cardRepo.findOne({ where: { id: cardId, userId } });
        if (!card) throw new NotFoundException('Card não encontrado');

        const column = await this.columnRepo.findOne({ where: { id: toColumnId, userId } });
        if (!column) throw new NotFoundException('Coluna de destino não encontrada');

        card.columnId = toColumnId;
        if (newOrder !== undefined) card.order = newOrder;
        return this.cardRepo.save(card);
    }

    async reorderColumn(userId: number, updates: { columnId: number; order: number }[]) {
        await Promise.all(
            updates.map((u) =>
                this.columnRepo.update({ id: u.columnId, userId }, { order: u.order }),
            ),
        );
        return { success: true };
    }

    async reorderCard(userId: number, updates: { cardId: number; columnId: number; order: number }[]) {
        await Promise.all(
            updates.map((u) =>
                this.cardRepo.update({ id: u.cardId, userId }, { columnId: u.columnId, order: u.order }),
            ),
        );
        return { success: true };
    }
}
