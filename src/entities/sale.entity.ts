import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';
import { Product } from './product.entity';
import { Campaign } from './campaign.entity';
import { Contact } from './contact.entity';

@Entity('sales')
export class Sale {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Product)
  @JoinColumn({ name: 'productId' })
  product: Product;

  @Column()
  productId: number;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  userId: number;

  @Column({ type: 'int' })
  quantity: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  unitPrice: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  totalValue: number;

  @Column({ length: 255, nullable: true })
  customerName: string;

  @Column({ length: 255, nullable: true })
  customerEmail: string;

  @Column({ length: 50, nullable: true })
  paymentMethod: string;

  @ManyToOne(() => Campaign, { nullable: true })
  @JoinColumn({ name: 'campaignId' })
  campaign: Campaign;

  @Column({ nullable: true })
  campaignId: number;

  @Column({ length: 50, nullable: true })
  channel: string;

  @ManyToOne(() => Contact, { nullable: true })
  @JoinColumn({ name: 'contactId' })
  contact: Contact;

  @Column({ nullable: true })
  contactId: number;

  @Column({ length: 50, default: 'completed' })
  status: string; // 'completed', 'processing', 'cancelled'

  @Column({ name: 'externalId', length: 255, nullable: true })
  externalId: string;

  @CreateDateColumn()
  createdAt: Date;
}
