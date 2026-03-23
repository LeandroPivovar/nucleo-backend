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
import { Campaign } from './campaign.entity';
import { Contact } from './contact.entity';

@Entity('campaign_coupons')
export class CampaignCoupon {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    userId: number;

    @ManyToOne(() => User)
    @JoinColumn({ name: 'userId' })
    user: User;

    @Column()
    campaignId: number;

    @ManyToOne(() => Campaign)
    @JoinColumn({ name: 'campaignId' })
    campaign: Campaign;

    @Column()
    contactId: number;

    @ManyToOne(() => Contact)
    @JoinColumn({ name: 'contactId' })
    contact: Contact;

    @Column()
    code: string;

    @Column({ nullable: true })
    platform: string; // 'shopify', 'nuvemshop', etc.

    @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
    value: number;

    @Column({ nullable: true })
    type: string; // 'absolute', 'percentage'

    @Column({ type: 'timestamp', nullable: true })
    startsAt: Date;

    @Column({ type: 'timestamp', nullable: true })
    endsAt: Date;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
