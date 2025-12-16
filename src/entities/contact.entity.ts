import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { User } from './user.entity';
import { ContactTag } from './contact-tag.entity';
import { ContactSegmentation } from './contact-segmentation.entity';
import { Group } from './group.entity';

@Entity('contacts')
export class Contact {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 100 })
  name: string;

  @Column({ length: 100, nullable: true })
  lastName: string;

  @Column({ length: 255, nullable: true })
  email: string;

  @Column({ length: 20, nullable: true })
  phone: string;

  @Column({ length: 100, nullable: true })
  company: string;

  @Column({ length: 100, nullable: true })
  position: string;

  @Column('text', { nullable: true })
  notes: string;

  @Column({ length: 50, nullable: true })
  status: string; // e.g., 'active', 'inactive', 'lead', 'customer'

  @Column({ length: 50, nullable: true })
  source: string; // e.g., 'website', 'referral', 'social_media'

  @Column({ length: 2, nullable: true })
  state: string; // Estado (UF) - e.g., 'SP', 'RJ'

  @Column({ length: 100, nullable: true })
  city: string; // Cidade

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  userId: number;

  @OneToMany(() => ContactTag, (contactTag) => contactTag.contact)
  contactTags: ContactTag[];

  @OneToMany(() => ContactSegmentation, (contactSegmentation) => contactSegmentation.contact)
  contactSegmentations: ContactSegmentation[];

  @ManyToOne(() => Group, { nullable: true })
  @JoinColumn({ name: 'groupId' })
  group: Group;

  @Column({ nullable: true })
  groupId: number | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

