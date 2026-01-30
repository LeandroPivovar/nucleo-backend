import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    ManyToOne,
    JoinColumn,
} from 'typeorm';
import { User } from './user.entity';

@Entity('campaigns')
export class Campaign {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ length: 255 })
    name: string;

    @Column({ length: 50 })
    complexity: string; // 'simple' | 'advanced'

    @Column({ length: 50 })
    channel: string; // 'email' | 'sms' | 'whatsapp'

    @Column({ length: 50, default: 'rascunho' })
    status: string; // 'rascunho' | 'ativa' | 'pausada' | 'agendada' | 'finalizada'

    @Column({ type: 'int', default: 0 })
    recipientsCount: number;

    @Column({ type: 'int', default: 0 })
    sentCount: number;

    @Column({ type: 'int', default: 0 })
    opensCount: number;

    @Column({ type: 'int', default: 0 })
    clicksCount: number;

    @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
    revenue: number;

    @Column({ type: 'json', nullable: true })
    config: any;

    @Column({ type: 'timestamp', nullable: true })
    scheduledAt: Date;

    @ManyToOne(() => User)
    @JoinColumn({ name: 'userId' })
    user: User;

    @Column()
    userId: number;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
