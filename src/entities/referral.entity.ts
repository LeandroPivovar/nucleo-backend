import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    ManyToOne,
    JoinColumn,
} from 'typeorm';
import { User } from './user.entity';

export type ReferralStatus =
    | 'received'
    | 'contacted'
    | 'meeting_scheduled'
    | 'negotiating'
    | 'converted'
    | 'not_converted'
    | 'pending' // Legacy
    | 'active'  // Legacy
    | 'cancelled'; // Legacy

@Entity('referrals')
export class Referral {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    referrerId: number; // Quem indicou

    @ManyToOne(() => User)
    @JoinColumn({ name: 'referrerId' })
    referrer: User;

    @Column({ nullable: true })
    referredId: number; // Quem foi indicado (pode ser null se for apenas um lead ainda nÃ£o cadastrado)

    @ManyToOne(() => User)
    @JoinColumn({ name: 'referredId' })
    referred: User;

    @Column({ nullable: true })
    referredName: string;

    @Column({ nullable: true })
    companyName: string;

    @Column({ nullable: true })
    phone: string;

    @Column({ nullable: true })
    email: string;

    @Column({ nullable: true })
    origin: string; // Ex: 'direct', 'social', 'campaign'

    @Column({ nullable: true })
    referralCode: string; // O cÃ³digo que foi usado

    @Column({ length: 30, default: 'received' })
    status: ReferralStatus;

    @CreateDateColumn()
    createdAt: Date;
}
