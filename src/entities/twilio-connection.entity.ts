import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from './user.entity';

@Entity('twilio_connections')
export class TwilioConnection {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 255, nullable: true })
  friendlyName: string;

  @Column({ length: 255 })
  whatsappFrom: string;

  @Column({ length: 255, nullable: true })
  accountSid: string;

  @Column({ type: 'text', nullable: true, select: false })
  authToken: string;

  @Column({
    type: 'enum',
    enum: ['pending', 'verified', 'rejected'],
    default: 'pending',
  })
  status: 'pending' | 'verified' | 'rejected';

  @Column({ type: 'text', nullable: true })
  adminNote: string;

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
