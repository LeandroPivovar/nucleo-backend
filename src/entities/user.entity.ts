import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { Plan } from './plan.entity';
import { Ticket } from './ticket.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 100 })
  firstName: string;

  @Column({ length: 100 })
  lastName: string;

  @Column({ unique: true, length: 255 })
  email: string;

  @Column({ length: 20, nullable: true })
  phone: string;

  @Column({ length: 20, nullable: true })
  document: string; // CPF ou CNPJ

  @Column({ length: 255, nullable: true })
  address: string;

  @Column({ length: 20, nullable: true })
  postalCode: string;

  @Column({ length: 255 })
  password: string;

  @Column({ length: 20, default: 'user' })
  role: string; // 'admin' | 'user'

  @Column({ default: false })
  active: boolean; // Conta ativa (verificada por e-mail)

  @Column({ default: 0 })
  emailsSentMonth: number;

  @Column({ length: 20, nullable: true, unique: true })
  referralCode: string; // Código único de indicação do usuário

  @Column({ nullable: true })
  referredById: number; // ID do usuário que indicou este usuário

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 3.00 })
  referralPercentage: number; // Porcentagem de comissão (ex: 3.00 para 3%)

  @Column({ length: 50, nullable: true })
  asaasCustomerId: string;

  @ManyToOne(() => Plan)
  @JoinColumn({ name: 'planId' })
  plan: Plan;

  @Column({ nullable: true })
  planId: number;

  @Column({ length: 50, nullable: true })
  subscriptionStatus: string;

  @Column({ default: 0 })
  extraEmailsBalance: number;

  @Column({ default: 0 })
  extraSmsBalance: number;

  @Column({ default: 0 })
  extraWhatsappBalance: number;

  // ── Twilio WhatsApp (subconta por usuário) ──────────────────────────────
  @Column({ type: 'varchar', length: 50, nullable: true })
  twilioAccountSid?: string; // AC...

  @Column({ type: 'varchar', length: 255, nullable: true })
  twilioAuthToken?: string; // Auth Token da subconta

  @Column({ type: 'varchar', length: 30, nullable: true })
  twilioWhatsappFrom?: string; // número E.164, ex: +14155238886
  // ───────────────────────────────────────────────────────────────────────

  @Column({ type: 'boolean', default: false })
  twoFactorEnabled: boolean;

  @Column({ type: 'varchar', length: 10, nullable: true })
  twoFactorCode?: string;

  @Column({ type: 'datetime', nullable: true })
  twoFactorExpires?: Date;

  @Column({ type: 'varchar', length: 4, nullable: true, unique: true })
  templateId: string;

  @Column({ type: 'datetime', nullable: true })
  lastLoginAt?: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => Ticket, (ticket) => ticket.user)
  tickets: Ticket[];
}
