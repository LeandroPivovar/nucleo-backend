import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    Index,
} from 'typeorm';

@Entity('webhook_logs')
export class WebhookLog {
    @PrimaryGeneratedColumn()
    id: number;

    @Index()
    @Column({ length: 255 })
    url: string;

    @Column({ length: 10 })
    method: string;

    @Column({ type: 'json', nullable: true })
    headers: any;

    @Column({ type: 'json', nullable: true })
    payload: any;

    @Index()
    @Column({ length: 50, nullable: true })
    source: string; // Ex: 'zapier', 'make', 'custom'

    // Dono do webhook (tenant). Null = sem dono identificado; visível só para admin.
    @Index()
    @Column({ type: 'int', nullable: true })
    userId: number | null;

    @CreateDateColumn()
    createdAt: Date;
}
