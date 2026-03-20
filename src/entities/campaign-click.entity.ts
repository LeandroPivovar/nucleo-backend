import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    ManyToOne,
    JoinColumn,
    Index,
} from 'typeorm';
import { Campaign } from './campaign.entity';
import { Contact } from './contact.entity';

@Entity('campaign_clicks')
export class CampaignClick {
    @PrimaryGeneratedColumn()
    id: number;

    @Index()
    @Column()
    campaignId: number;

    @Index()
    @Column()
    contactId: number;

    @ManyToOne(() => Campaign, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'campaignId' })
    campaign: Campaign;

    @ManyToOne(() => Contact, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'contactId' })
    contact: Contact;

    @CreateDateColumn()
    createdAt: Date;
}
