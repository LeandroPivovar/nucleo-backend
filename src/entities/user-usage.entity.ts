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

@Entity('user_usages')
export class UserUsage {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    userId: number;

    @ManyToOne(() => User)
    @JoinColumn({ name: 'userId' })
    user: User;

    @Column({ length: 7 }) // Format: YYYY-MM
    monthYear: string;

    @Column({ type: 'int', default: 0 })
    emailsSent: number;

    @Column({ type: 'int', default: 0 })
    smsSent: number;

    @Column({ type: 'int', default: 0 })
    whatsappSent: number;

    @Column({ type: 'int', default: 0 })
    campaignsCreated: number;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
