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
    contactId: number | null;

    @Index({ unique: true })
    @Column({ length: 80 })
    messageSid: string;

    @Column({ length: 40 })
    status: string;

    @Column({ length: 30, default: 'twilio' })
    provider: string;

    @CreateDateColumn()
    createdAt: Date;
}
