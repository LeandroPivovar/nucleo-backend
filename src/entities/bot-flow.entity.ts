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
import type { BotFlowChannel } from '../bot-flows/bot-flow-channel';

@Entity('bot_flows')
@Index(['userId'])
export class BotFlow {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  userId: number;

  @Column({ length: 150 })
  name: string;

  @Column({ length: 50 })
  channel: BotFlowChannel;

  @Column({ type: 'json', nullable: true })
  nodes: any;

  @Column({ type: 'json', nullable: true })
  edges: any;

  @Column({ type: 'boolean', default: false })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
