import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, In } from 'typeorm';
import { Notification } from '../entities/notification.entity';
import { UserNotification } from '../entities/user-notification.entity';
import { NotificationPreference } from '../entities/notification-preference.entity';

@Injectable()
export class NotificationsService {
    constructor(
        @InjectRepository(Notification)
        private notificationRepository: Repository<Notification>,
        @InjectRepository(UserNotification)
        private userNotificationRepository: Repository<UserNotification>,
        @InjectRepository(NotificationPreference)
        private preferenceRepository: Repository<NotificationPreference>,
    ) { }

    async findAllForUser(userId: number) {
        // Obter preferências desativadas
        const disabledPreferences = await this.preferenceRepository.find({
            where: { userId, enabled: false },
        });
        const disabledTypes = disabledPreferences.map(p => p.type);

        // Buscar todas as notificações globais ou específicas para o usuário
        const query = this.notificationRepository.createQueryBuilder('n')
            .where('(n.userId IS NULL OR n.userId = :userId)', { userId });

        if (disabledTypes.length > 0) {
            query.andWhere('n.type NOT IN (:...disabledTypes)', { disabledTypes });
        }

        const notifications = await query
            .orderBy('n.createdAt', 'DESC')
            .take(50)
            .getMany();

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
        // Obter preferências desativadas
        const disabledPreferences = await this.preferenceRepository.find({
            where: { userId, enabled: false },
        });
        const disabledTypes = disabledPreferences.map(p => p.type);

        // Buscar todas as notificações elegíveis (globais ou do usuário)
        const query = this.notificationRepository.createQueryBuilder('n')
            .select('n.id')
            .where('(n.userId IS NULL OR n.userId = :userId)', { userId });

        if (disabledTypes.length > 0) {
            query.andWhere('n.type NOT IN (:...disabledTypes)', { disabledTypes });
        }

        const notifications = await query.getMany();

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

    async getPreferences(userId: number) {
        const preferences = await this.preferenceRepository.find({
            where: { userId },
        });
        return preferences;
    }

    async updatePreferences(userId: number, preferences: { type: any, enabled: boolean }[]) {
        for (const pref of preferences) {
            let p = await this.preferenceRepository.findOne({
                where: { userId, type: pref.type },
            });

            if (!p) {
                p = this.preferenceRepository.create({
                    userId,
                    type: pref.type,
                    enabled: pref.enabled,
                });
            } else {
                p.enabled = pref.enabled;
            }

            await this.preferenceRepository.save(p);
        }
        return { success: true };
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

    async exists(userId: number, type: string, title: string) {
        const count = await this.notificationRepository.count({
            where: { userId, type: type as any, title },
        });
        return count > 0;
    }

    async isPreferenceEnabled(userId: number, type: string): Promise<boolean> {
        const preference = await this.preferenceRepository.findOne({
            where: { userId, type: type as any },
        });
        return preference ? preference.enabled : true; // Default to true if not set
    }

    async delete(id: number) {
        const result = await this.notificationRepository.delete(id);
        if (result.affected === 0) {
            throw new NotFoundException('Notificação não encontrada');
        }
        return { success: true };
    }
}
