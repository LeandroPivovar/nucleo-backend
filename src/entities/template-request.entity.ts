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

export enum TemplateRequestStatus {
  PENDING_PAYMENT = 'pending_payment',
  REQUESTED = 'requested',
  CREATED = 'created',
  REJECTED = 'rejected',
}

@Entity('template_requests')
export class TemplateRequest {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  userId: number;

  @Column({ type: 'text' })
  content: string;

  @Column({
    type: 'enum',
    enum: TemplateRequestStatus,
    default: TemplateRequestStatus.PENDING_PAYMENT,
  })
  status: TemplateRequestStatus;

  @Column({ length: 150, nullable: true })
  paymentId: string;

  @Column({ type: 'text', nullable: true })
  adminNote: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
