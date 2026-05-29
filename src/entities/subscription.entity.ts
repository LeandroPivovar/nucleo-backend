import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, OneToMany } from 'typeorm';
import { User } from './user.entity';
import { Plan } from './plan.entity';
import { Invoice } from './invoice.entity';

@Entity('subscriptions')
export class Subscription {
    @PrimaryGeneratedColumn()
    id: number;

    @ManyToOne(() => User)
    @JoinColumn({ name: 'userId' })
    user: User;

    @Column()
    userId: number;

    @ManyToOne(() => Plan)
    @JoinColumn({ name: 'planId' })
    plan: Plan;

    @Column()
    planId: number;

    @Column({ length: 50, default: 'active' })
    status: string; // 'active', 'past_due', 'canceled', 'incomplete'

    @Column({ type: 'timestamp' })
    currentPeriodStart: Date;

    @Column({ type: 'timestamp' })
    currentPeriodEnd: Date;

    @Column({ default: false })
    cancelAtPeriodEnd: boolean;

    @Column({ length: 255, nullable: true })
    cancellationReason: string;

    @Column({ nullable: true })
    stripeSubscriptionId: string; // For future Stripe integration

    @Column({ length: 50, nullable: true })
    asaasSubscriptionId: string;

    @Column({ length: 255, nullable: true })
    shopifySubscriptionId: string; // gid://shopify/AppSubscription/... (Shopify Billing API)

    @OneToMany(() => Invoice, invoice => invoice.subscription)
    invoices: Invoice[];

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
