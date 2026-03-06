import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, In } from 'typeorm';
import { Notification } from '../entities/notification.entity';
import { UserNotification } from '../entities/user-notification.entity';

@Injectable()
export class NotificationsService {
    constructor(
        @InjectRepository(Notification)
        private notificationRepository: Repository<Notification>,
        @InjectRepository(UserNotification)
        private userNotificationRepository: Repository<UserNotification>,
    ) { }

    async findAllForUser(userId: number) {
        // Buscar todas as notificações globais ou específicas para o usuário
        const notifications = await this.notificationRepository.find({
            where: [
                { userId: IsNull() },
                { userId: userId },
            ],
            order: { createdAt: 'DESC' },
            take: 50,
        });

        // Buscar status de leitura e deleção para o usuário
        const readStatuses = await this.userNotificationRepository.find({
            where: {
                userId,
                notificationId: In(notifications.map(n => n.id)),
            },
        });

        const statusMap = new Map();
        readStatuses.forEach(rs => statusMap.set(rs.notificationId, { readAt: rs.readAt, deletedAt: rs.deletedAt }));

        return notifications
            .filter(n => !statusMap.get(n.id)?.deletedAt)
            .map(n => ({
                ...n,
                read: !!statusMap.get(n.id)?.readAt,
                readAt: statusMap.get(n.id)?.readAt || null,
            }));
    }

    async markAsRead(userId: number, notificationId: number) {
        let userNotification = await this.userNotificationRepository.findOne({
            where: { userId, notificationId },
        });

        if (!userNotification) {
            userNotification = this.userNotificationRepository.create({
                userId,
                notificationId,
                readAt: new Date(),
            });
        } else {
            userNotification.readAt = new Date();
        }

        return this.userNotificationRepository.save(userNotification);
    }

    async markAsDeleted(userId: number, notificationId: number) {
        let userNotification = await this.userNotificationRepository.findOne({
            where: { userId, notificationId },
        });

        if (!userNotification) {
            userNotification = this.userNotificationRepository.create({
                userId,
                notificationId,
                deletedAt: new Date(),
            });
        } else {
            userNotification.deletedAt = new Date();
        }

        return this.userNotificationRepository.save(userNotification);
    }

    async getUnreadCount(userId: number) {
        // Buscar todas as notificações elegíveis (globais ou do usuário)
        const notifications = await this.notificationRepository.find({
            where: [
                { userId: IsNull() },
                { userId: userId },
            ],
            select: ['id'],
        });

        if (notifications.length === 0) return { count: 0 };

        const notificationIds = notifications.map(n => n.id);

        // Buscar status que mostram que a notificação foi lida OU excluída
        const readOrDeletedCount = await this.userNotificationRepository.createQueryBuilder('un')
            .where('un.userId = :userId', { userId })
            .andWhere('un.notificationId IN (:...ids)', { ids: notificationIds })
            .andWhere('(un.readAt IS NOT NULL OR un.deletedAt IS NOT NULL)')
            .getCount();

        return { count: Math.max(0, notifications.length - readOrDeletedCount) };
    }

    // Admin methods
    async findAllAdmin() {
        return this.notificationRepository.find({
            order: { createdAt: 'DESC' },
            relations: ['user'],
        });
    }

    async create(data: Partial<Notification>) {
        const notification = this.notificationRepository.create(data);
        return this.notificationRepository.save(notification);
    }

    async delete(id: number) {
        const result = await this.notificationRepository.delete(id);
        if (result.affected === 0) {
            throw new NotFoundException('Notificação não encontrada');
        }
        return { success: true };
    }
}
