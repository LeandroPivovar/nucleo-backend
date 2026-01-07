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

@Entity('vtex_connections')
export class VtexConnection {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  userId: number;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ length: 255 })
  accountName: string; // Nome da conta VTEX (ex: minhaloja)

  @Column({ type: 'text' })
  appKey: string; // AppKey criptografado

  @Column({ type: 'text' })
  appToken: string; // AppToken criptografado

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'datetime', nullable: true })
  lastSyncAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

