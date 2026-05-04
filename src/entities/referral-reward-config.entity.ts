import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
} from 'typeorm';

@Entity('referral_reward_configs')
export class ReferralRewardConfig {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ length: 30 })
    type: 'fixed' | 'percentage' | 'recurrent' | 'credit' | 'discount' | 'cashback';

    @Column({ type: 'decimal', precision: 10, scale: 2 })
    value: number;

    @Column({ nullable: true })
    durationMonths: number; // Para recorrentes

    @Column({ length: 255, nullable: true })
    description: string;

    @Column({ default: true })
    isActive: boolean;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
