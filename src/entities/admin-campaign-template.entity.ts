import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
} from 'typeorm';

@Entity('admin_campaign_templates')
export class AdminCampaignTemplate {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ length: 255 })
    name: string;

    @Column({ length: 50, default: 'rascunho' })
    status: string; // 'rascunho' | 'publicada'

    @Column({ type: 'json', nullable: true })
    workflow: any; // { nodes: [], edges: [] }

    @Column({ type: 'text', nullable: true })
    description: string;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
