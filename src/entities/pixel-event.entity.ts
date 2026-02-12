import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    Index,
    ManyToOne,
    JoinColumn,
} from 'typeorm';
import { Pixel } from './pixel.entity';

@Entity('pixel_events')
export class PixelEvent {
    @PrimaryGeneratedColumn()
    id: number;

    @Index()
    @Column({ length: 36 })
    pixelId: string;

    @Index()
    @Column({ length: 50 })
    event: string;

    @Column({ type: 'json', nullable: true })
    data: any;

    @Column({ type: 'text', nullable: true })
    url: string;

    @Column({ type: 'text', nullable: true })
    userAgent: string;

    @Column({ length: 45, nullable: true })
    ip: string; // Anonimizado

    @Column({ type: 'text', nullable: true })
    pageTitle: string; // Título da página

    @Column({ length: 100, nullable: true })
    sessionId: string;

    @Column({ length: 100, nullable: true })
    sku: string;

    @Index()
    @Column({ type: 'bigint' })
    timestamp: string; // Guardado como bigInt o string para precisión de milisegundos

    @ManyToOne(() => Pixel)
    @JoinColumn({ name: 'pixelId', referencedColumnName: 'pixelId' })
    pixel: Pixel;

    @CreateDateColumn()
    createdAt: Date;
}
