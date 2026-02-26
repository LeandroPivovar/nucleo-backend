import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

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

  @Column({ length: 255 })
  password: string;

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

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
