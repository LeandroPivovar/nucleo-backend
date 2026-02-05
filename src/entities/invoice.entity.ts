import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Subscription } from './subscription.entity';
import { User } from './user.entity';

@Entity('invoices')
export class Invoice {
    @PrimaryGeneratedColumn()
    id: number;

    @ManyToOne(() => Subscription, subscription => subscription.invoices)
    @JoinColumn({ name: 'subscriptionId' })
    subscription: Subscription;

    @Column({ nullable: true })
    subscriptionId: number;

    @ManyToOne(() => User)
    @JoinColumn({ name: 'userId' })
    user: User;

    @Column()
    userId: number;

    @Column({ type: 'decimal', precision: 10, scale: 2 })
    amount: number;

    @Column({ length: 50 })
    status: string; // 'paid', 'open', 'void', 'uncollectible'

    @Column({ length: 255, nullable: true })
    hostedInvoiceUrl: string;

    @Column({ length: 255, nullable: true })
    pdfUrl: string;

    @Column({ nullable: true })
    stripeInvoiceId: string;

    @CreateDateColumn()
    createdAt: Date;
}
