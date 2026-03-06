import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { AdminNotificationsController } from './admin-notifications.controller';
import { Notification } from '../entities/notification.entity';
import { UserNotification } from '../entities/user-notification.entity';

@Module({
    imports: [TypeOrmModule.forFeature([Notification, UserNotification])],
    controllers: [NotificationsController, AdminNotificationsController],
    providers: [NotificationsService],
    exports: [NotificationsService],
})
export class NotificationsModule { }
