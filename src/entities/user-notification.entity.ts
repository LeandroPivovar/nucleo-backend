import {
    Entity,
    PrimaryColumn,
    Column,
    CreateDateColumn,
    ManyToOne,
    JoinColumn,
} from 'typeorm';
import { User } from './user.entity';
import { Notification } from './notification.entity';

@Entity('user_notifications')
export class UserNotification {
    @PrimaryColumn()
    userId: number;

    @PrimaryColumn()
    notificationId: number;

    @Column({ type: 'timestamp', nullable: true })
    readAt: Date | null;

    @Column({ type: 'timestamp', nullable: true, default: null })
    deletedAt: Date | null;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'userId' })
    user: User;

    @ManyToOne(() => Notification, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'notificationId' })
    notification: Notification;

    @CreateDateColumn()
    createdAt: Date;
}
