import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export type BotSessionStatus = 'active' | 'waiting_input' | 'completed';

export interface BotChatHistoryEntry {
  role: 'user' | 'assistant';
  text: string;
}

@Entity('bot_conversation_sessions')
@Index(['botFlowId', 'chatId'], { unique: true })
export class BotConversationSession {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  botFlowId: number;

  @Column({ type: 'varchar', length: 64 })
  chatId: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  currentNodeId?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  waitingAtNodeId?: string;

  @Column({ type: 'varchar', length: 20, default: 'active' })
  status: BotSessionStatus;

  @Column({ type: 'json', nullable: true })
  history: BotChatHistoryEntry[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
