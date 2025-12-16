import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { Contact } from './contact.entity';

@Entity('contact_segmentations')
@Index(['contactId', 'segmentationId'], { unique: true }) // Evita duplicatas
export class ContactSegmentation {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Contact, (contact) => contact.contactSegmentations, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'contactId' })
  contact: Contact;

  @Column()
  contactId: number;

  @Column({ length: 100 })
  segmentationId: string; // ID da segmentação (ex: 'by_purchase_count', 'birthday', etc.)

  @CreateDateColumn()
  createdAt: Date;
}

