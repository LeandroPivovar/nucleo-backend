import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    ManyToOne,
    JoinColumn,
} from 'typeorm';
import { User } from './user.entity';

@Entity('login_attempts')
export class LoginAttempt {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ nullable: true })
    userId: number;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'userId' })
    user: User;

    @Column({ length: 255 })
    email: string;

    @Column({ length: 45 }) // IPv6 size
    ip: string;

    @Column({ length: 100, nullable: true })
    city: string;

    @Column({ length: 100, nullable: true })
    country: string;

    @Column()
    success: boolean;

    @Column({ default: false })
    twoFactorUsed: boolean;

    @CreateDateColumn()
    createdAt: Date;
}
