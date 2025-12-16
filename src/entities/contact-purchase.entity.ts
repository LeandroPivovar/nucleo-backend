import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Contact } from './contact.entity';
import { Product } from './product.entity';

@Entity('contact_purchases')
export class ContactPurchase {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Contact)
  @JoinColumn({ name: 'contactId' })
  contact: Contact;

  @Column()
  contactId: number;

  @ManyToOne(() => Product, { nullable: true })
  @JoinColumn({ name: 'productId' })
  product: Product;

  @Column({ nullable: true })
  productId: number | null;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  value: number;

  @Column({ length: 255, nullable: true })
  productName: string; // Nome do produto (pode ser diferente do produto cadastrado)

  @Column({ length: 50, nullable: true })
  paymentMethod: string; // 'credit_card', 'pix', 'boleto', etc.

  @Column({ length: 50, default: 'completed' })
  status: string; // 'completed', 'processing', 'cancelled', 'refunded'

  @Column({ type: 'date' })
  purchaseDate: Date;

  @CreateDateColumn()
  createdAt: Date;
}

