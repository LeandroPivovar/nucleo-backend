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
    amount: number; // Valor da comissÃ£o em reais

    @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
    percentage: number; // Porcentagem aplicada no momento (histÃ³rico)

    @Column({ length: 30, default: 'pending' })
    status: 'pending' | 'approved' | 'paid' | 'cancelled';

    @Column({ length: 30, default: 'percentage' })
    commissionType: 'fixed' | 'percentage' | 'recurrent' | 'credit' | 'discount' | 'cashback';

    @Column({ type: 'timestamp', nullable: true })
    expectedPaymentDate: Date;

    @Column({ type: 'timestamp', nullable: true })
    paymentDate: Date;

    @CreateDateColumn()
    createdAt: Date;
}
