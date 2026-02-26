import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    ManyToOne,
    JoinColumn,
} from 'typeorm';
import { User } from './user.entity';
import { Subscription } from './subscription.entity';

@Entity('referral_commissions')
export class ReferralCommission {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    referrerId: number; // Quem recebe a comissão

    @ManyToOne(() => User)
    @JoinColumn({ name: 'referrerId' })
    referrer: User;

    @Column()
    referredId: number; // De quem veio a comissão (o indicado que pagou)

    @ManyToOne(() => User)
    @JoinColumn({ name: 'referredId' })
    referred: User;

    @Column({ nullable: true })
    subscriptionId: number;

    @ManyToOne(() => Subscription)
    @JoinColumn({ name: 'subscriptionId' })
    subscription: Subscription;

    @Column({ type: 'decimal', precision: 10, scale: 2 })
    amount: number; // Valor da comissão em reais

    @Column({ type: 'decimal', precision: 5, scale: 2 })
    percentage: number; // Porcentagem aplicada no momento (histórico)

    @CreateDateColumn()
    createdAt: Date;
}
