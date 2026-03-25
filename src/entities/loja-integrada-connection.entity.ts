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

@Entity('loja_integrada_connections')
export class LojaIntegradaConnection {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    userId: number;

    @ManyToOne(() => User)
    @JoinColumn({ name: 'userId' })
    user: User;

    @Column({ length: 255 })
    storeName: string;

    @Column({ type: 'text' })
    apiKey: string; // Token criptografado

    @Column({ type: 'text' })
    applicationKey: string; // Token criptografado

    @Column({ default: true })
    isActive: boolean;

    @Column({ type: 'datetime', nullable: true })
    lastSyncAt: Date;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
