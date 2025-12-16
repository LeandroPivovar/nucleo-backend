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
import { Tag } from './tag.entity';

@Entity('contact_tags')
@Index(['contactId', 'tagId'], { unique: true }) // Evita duplicatas
export class ContactTag {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Contact, (contact) => contact.contactTags, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'contactId' })
  contact: Contact;

  @Column()
  contactId: number;

  @ManyToOne(() => Tag, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tagId' })
  tag: Tag;

  @Column()
  tagId: number;

  @CreateDateColumn()
  createdAt: Date;
}

