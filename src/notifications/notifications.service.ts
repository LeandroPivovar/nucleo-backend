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

        // Buscar status de leitura para o usuário
        const readStatuses = await this.userNotificationRepository.find({
            where: {
                userId,
                notificationId: In(notifications.map(n => n.id)),
            },
        });

        const readMap = new Map();
        readStatuses.forEach(rs => readMap.set(rs.notificationId, rs.readAt));

        return notifications.map(n => ({
            ...n,
            read: !!readMap.get(n.id),
            readAt: readMap.get(n.id) || null,
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

    async getUnreadCount(userId: number) {
        // Esta é uma query um pouco mais complexa pois precisamos contar notificações
        // globais/pessoais que NÃO possuem entrada em user_notifications com readAt preenchido

        // Simplificando por enquanto: contar total de notificações elegíveis - total de lidas
        const totalEligible = await this.notificationRepository.count({
            where: [
                { userId: IsNull() },
                { userId: userId },
            ],
        });

        const totalRead = await this.userNotificationRepository.count({
            where: {
                userId,
                readAt: In(
                    (await this.notificationRepository.find({
                        where: [
                            { userId: IsNull() },
                            { userId: userId },
                        ],
                        select: ['id'],
                    })).map(n => n.id)
                ),
            },
        });

        return { count: Math.max(0, totalEligible - totalRead) };
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
