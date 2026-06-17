import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { User } from './user.entity';
import { Campaign } from './campaign.entity';

export type KanbanEntryType = 'capture_page' | 'form' | 'product_purchase' | 'ecommerce_event' | 'manual';

export interface KanbanCondition {
    type: 'has_purchased_product' | 'has_tag' | 'has_segmentation' | 'min_order_count' | 'min_ltv';
    value: string | number;
}

@Entity('kanban_columns')
export class KanbanColumn {
    @PrimaryGeneratedColumn()
    id: number;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'userId' })
    user: User;

    @Column()
    userId: number;

    @Column({ length: 100 })
    name: string;

    @Column({ type: 'text', nullable: true })
    description: string;

    @Column({ type: 'int', default: 0 })
    order: number;

    @Column({ type: 'boolean', default: true })
    active: boolean;

    @Column({ name: 'is_origin', type: 'boolean', default: false })
    isOrigin: boolean;

    @Column({ name: 'entry_type', length: 50, nullable: true })
    entryType: KanbanEntryType | null;

    @Column({ name: 'entry_config', type: 'json', nullable: true })
    entryConfig: Record<string, any> | null;

    @ManyToOne(() => Campaign, { nullable: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'campaign_id' })
    campaign: Campaign | null;

    @Column({ name: 'campaign_id', nullable: true })
    campaignId: number | null;

    @Column({ type: 'json', nullable: true })
    conditions: KanbanCondition[] | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
