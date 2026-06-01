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
import { BotFlow } from './bot-flow.entity';
import { User } from './user.entity';

export type BotTelegramConnectionStatus = 'connected' | 'disconnected' | 'error';

@Entity('bot_telegram_connections')
@Index(['botFlowId'], { unique: true })
@Index(['telegramBotId'], { unique: true })
export class BotTelegramConnection {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  botFlowId: number;

  @ManyToOne(() => BotFlow, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'botFlowId' })
  botFlow: BotFlow;

  @Column()
  userId: number;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'text', select: false })
  botToken: string;

  @Column({ length: 32 })
  telegramBotId: string;

  @Column({ length: 255, nullable: true })
  botUsername: string | null;

  @Column({ length: 64 })
  webhookSecret: string;

  @Column({ length: 20, default: 'connected' })
  status: BotTelegramConnectionStatus;

  @Column({ type: 'datetime', nullable: true })
  connectedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
