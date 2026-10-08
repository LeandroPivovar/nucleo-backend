import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { User } from './user.entity';
import { ContactTag } from './contact-tag.entity';
import { ContactSegmentation } from './contact-segmentation.entity';
import { Group } from './group.entity';
import { Sale } from './sale.entity';

@Entity('contacts')
@Index(['userId', 'email'], { unique: true })
export class Contact {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 100 })
  name: string;

  @Column({ length: 255, nullable: true })
  email: string;

  @Column({ length: 50, nullable: true })
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

  @Column({ length: 50, nullable: true })
  state: string; // Estado (UF) - e.g., 'SP', 'RJ'

  @Column({ length: 100, nullable: true })
  city: string; // Cidade

  @Column({ type: 'date', nullable: true })
  birthDate: Date; // Data de nascimento

  @Column({ length: 1, nullable: true })
  gender: string; // 'M' | 'F'

  @Column({ length: 20, nullable: true })
  cpfCnpj: string;

  // ID do cliente na plataforma de origem (ex.: customer id da Shopify).
  // Permite casar/excluir o contato mesmo se o e-mail mudar.
  // `type` explícito é obrigatório aqui: com o tipo união TypeScript o TypeORM
  // não consegue inferir a coluna e quebra o boot.
  @Index()
  @Column({ type: 'varchar', length: 100, nullable: true })
  externalId: string | null;

  // Consentimento de marketing sincronizado da origem. `null` = desconhecido
  // (contatos antigos/importados) — o disparo trata null como não bloqueado
  // para não quebrar bases existentes; `false` bloqueia o envio.
  @Column({ type: 'boolean', nullable: true })
  emailOptIn: boolean | null;

  @Column({ type: 'boolean', nullable: true })
  smsOptIn: boolean | null;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  userId: number;

  @OneToMany(() => ContactTag, (contactTag) => contactTag.contact)
  contactTags: ContactTag[];

  @OneToMany(() => ContactSegmentation, (contactSegmentation) => contactSegmentation.contact)
  contactSegmentations: ContactSegmentation[];

  @OneToMany(() => Sale, (sale) => sale.contact)
  sales: Sale[];

  @ManyToOne(() => Group, { nullable: true })
  @JoinColumn({ name: 'groupId' })
  group: Group;

  @Column({ nullable: true })
  groupId?: number;

  // Virtual fields populated in service
  hasClickedCampaign?: boolean;
  hasActiveCoupon?: boolean;

  @CreateDateColumn()

  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

