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
    emailsSent: number = 0;

    @Column({ type: 'int', default: 0 })
    smsSent: number = 0;

    @Column({ type: 'int', default: 0 })
    whatsappSent: number = 0;

    @Column({ type: 'int', default: 0 })
    campaignsCreated: number = 0;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
