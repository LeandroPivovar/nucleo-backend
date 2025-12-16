import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';

@Entity('score_configs')
export class ScoreConfig {
  @PrimaryGeneratedColumn()
  id: number;

  @OneToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  userId: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 2 })
  emailOpens: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 3 })
  linkClicks: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 10 })
  purchases: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 10 })
  ltvDivisor: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

