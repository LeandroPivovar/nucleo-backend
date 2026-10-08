import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    Index,
} from 'typeorm';

@Entity('campaign_message_events')
export class CampaignMessageEvent {
    @PrimaryGeneratedColumn()
    id: number;

    @Index()
    @Column()
    campaignId: number;

    @Index()
    @Column({ nullable: true })
    contactId?: number;

    @Index({ unique: true })
    @Column({ length: 191 })
    messageSid: string;

    @Column({ length: 40 })
    status: string;

    @Column({ length: 30, default: 'twilio' })
    provider: string;

    @Column({ type: 'datetime', nullable: true })
    deliveredAt?: Date;

    @Column({ type: 'datetime', nullable: true })
    readAt?: Date;

    @Column({ type: 'datetime', nullable: true })
    clickedAt?: Date;

    @Column({ type: 'datetime', nullable: true })
    failedAt?: Date;

    @Column({ type: 'text', nullable: true })
    failureReason?: string;

    @CreateDateColumn()
    createdAt: Date;
}
