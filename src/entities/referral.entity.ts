import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    ManyToOne,
    JoinColumn,
} from 'typeorm';
import { User } from './user.entity';

export type ReferralStatus = 'pending' | 'active' | 'cancelled';

@Entity('referrals')
export class Referral {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    referrerId: number; // Quem indicou

    @ManyToOne(() => User)
    @JoinColumn({ name: 'referrerId' })
    referrer: User;

    @Column()
    referredId: number; // Quem foi indicado

    @ManyToOne(() => User)
    @JoinColumn({ name: 'referredId' })
    referred: User;

    @Column({ length: 20, default: 'pending' })
    status: ReferralStatus;

    @CreateDateColumn()
    createdAt: Date;
}
