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

export type BotWhatsappConnectionStatus = 'disconnected' | 'qr_ready' | 'connecting' | 'connected' | 'error';

@Entity('bot_whatsapp_connections')
@Index(['botFlowId'], { unique: true })
export class BotWhatsappConnection {
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

  @Column({ type: 'varchar', length: 20, default: 'disconnected' })
  status: BotWhatsappConnectionStatus;

  @Column({ type: 'text', nullable: true })
  qrCode: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  botPhoneNumber: string | null;

  @Column({ type: 'datetime', nullable: true })
  connectedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
