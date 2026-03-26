import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    ManyToOne,
    JoinColumn,
    Index,
} from 'typeorm';
import { User } from './user.entity';

@Entity('internal_analytics')
export class InternalAnalytics {
    @PrimaryGeneratedColumn()
    id: number;

    @Index()
    @Column({ nullable: true })
    userId: number | null;

    @ManyToOne(() => User)
    @JoinColumn({ name: 'userId' })
    user: User;

    @Index()
    @Column({ length: 50 })
    type: 'page_view' | 'action';

    @Index()
    @Column({ length: 100 })
    name: string; // URL da página ou Nome da Função/Botão

    @Column({ type: 'json', nullable: true })
    metadata: any;

    @CreateDateColumn()
    @Index()
    timestamp: Date;
}
