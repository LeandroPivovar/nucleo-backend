import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { User } from './user.entity';

export enum EmailTemplateCategory {
  TRANSACTIONAL = 'transactional',
  MARKETING = 'marketing',
  NOTIFICATION = 'notification',
  CUSTOM = 'custom',
}

@Entity('email_templates')
export class EmailTemplate {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  userId: number;

  @Column({ length: 150 })
  name: string;

  @Column({ type: 'enum', enum: EmailTemplateCategory, default: EmailTemplateCategory.CUSTOM })
  category: EmailTemplateCategory;

  @Column({ type: 'text' })
  html: string;

  @Column({ length: 200, nullable: true })
  subject: string;

  @Column({ length: 255, nullable: true })
  description: string;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
