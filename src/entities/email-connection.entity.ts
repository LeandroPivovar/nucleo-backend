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

@Entity('email_connections')
export class EmailConnection {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'enum', enum: ['smtp', 'domain'], default: 'smtp' })
  type: 'smtp' | 'domain';

  @Column({ length: 255, nullable: true })
  domain: string;

  @Column({ type: 'enum', enum: ['pending', 'verified', 'rejected'], default: 'verified' })
  status: 'pending' | 'verified' | 'rejected';

  @Column({ type: 'text', nullable: true })
  dnsTxt: string;

  @Column({ type: 'text', nullable: true })
  dnsCname: string;

  @Column({ type: 'text', nullable: true })
  dnsMx: string;

  @Column({ type: 'text', nullable: true })
  adminNote: string;

  @Column({ length: 255, nullable: true })
  email: string;

  @Column({ length: 255, nullable: true })
  smtpHost: string;

  @Column({ type: 'int', nullable: true })
  smtpPort: number;

  @Column({ length: 255, nullable: true })
  username: string;

  @Column({ length: 255, select: false, nullable: true })
  password: string;

  @Column({ type: 'boolean', default: false })
  secure: boolean;

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


