import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    ManyToOne,
    JoinColumn,
    Index,
} from 'typeorm';
import { User } from './user.entity';

@Entity('pixels')
export class Pixel {
    @PrimaryGeneratedColumn()
    id: number;

    @Index({ unique: true })
    @Column({ length: 36 })
    pixelId: string; // Generado UUID

    @Column({ length: 255 })
    name: string;

    @ManyToOne(() => User)
    @JoinColumn({ name: 'userId' })
    user: User;

    @Column()
    userId: number;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
