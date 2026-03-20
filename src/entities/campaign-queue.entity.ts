import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Campaign } from './campaign.entity';
import { Contact } from './contact.entity';
import { User } from './user.entity';

@Entity('campaign_queue')
export class CampaignQueue {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ name: 'user_id' })
    userId: number;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id' })
    user: User;

    @Column({ name: 'campaign_id' })
    campaignId: number;

    @ManyToOne(() => Campaign, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'campaign_id' })
    campaign: Campaign;

    @Column({ name: 'contact_id' })
    contactId: number;

    @ManyToOne(() => Contact, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'contact_id' })
    contact: Contact;

    @Column({ name: 'delay_node_id', length: 100 })
    delayNodeId: string;

    @Column({ name: 'resume_at', type: 'datetime' })
    resumeAt: Date;

    @Column({ type: 'json', nullable: true })
    eventContext: any;

    @Column({ length: 50, default: 'pending' })
    status: string; // 'pending' | 'processing' | 'completed' | 'failed'

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}
