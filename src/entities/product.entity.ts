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
import { Category } from './category.entity';

@Entity('products')
export class Product {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 255 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  price: number;

  @Column({ type: 'int', default: 0 })
  stock: number;

  @Column({ length: 100, nullable: true })
  sku: string;

  @Column({ length: 50, nullable: true })
  category: string;

  @Column({ nullable: true })
  categoryId: number;

  @ManyToOne(() => Category)
  @JoinColumn({ name: 'categoryId' })
  categoryEntity: Category;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @Column({ type: 'json', nullable: true })
  externalIds: {
    nuvemshop?: Record<string, number>; // { storeId: productId }
    shopify?: Record<string, string>; // { shop: productId }
  } | null;

  @Column({ type: 'text', nullable: true })
  coverPhoto: string | null;

  @Column({ type: 'json', nullable: true })
  gallery: string[] | null;

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

