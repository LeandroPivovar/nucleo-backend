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

@Entity('shopify_connections')
export class ShopifyConnection {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  userId: number;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ length: 255 })
  shop: string; // Ex: sualoja.myshopify.com

  @Column({ type: 'text', nullable: true })
  accessToken: string; // Token criptografado

  @Column({ type: 'text', nullable: true })
  refreshToken: string | null; // Token de atualização criptografado

  @Column({ type: 'datetime', nullable: true })
  expiresAt: Date | null; // Data de expiração do token

  @Column({ type: 'text', nullable: true })
  scope: string | null; // Escopos autorizados

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'datetime', nullable: true })
  lastSyncAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}


