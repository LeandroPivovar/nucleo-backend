import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum LeadStatus {
  PENDING = 'pending',
  CONTACT_SENT = 'contact_sent',
  NO_RESPONSE = 'no_response',
  CONVERTED = 'converted',
  MEETING_SCHEDULED = 'meeting_scheduled',
}

@Entity('lead_requests')
export class LeadRequest {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 150 })
  name: string;

  @Column({ length: 255 })
  email: string;

  @Column({ length: 30 })
  phone: string;

  @Column({ length: 150 })
  company: string;

  @Column({ length: 100, nullable: true })
  source: string;

  @Column({
    type: 'enum',
    enum: LeadStatus,
    default: LeadStatus.PENDING,
  })
  status: LeadStatus;

  @Column({ type: 'text', nullable: true })
  adminNote: string;

  @Column({ length: 150, nullable: true })
  segmento: string;

  @Column({ length: 150, nullable: true })
  canalVendas: string;

  @Column({ length: 150, nullable: true })
  instagram: string;

  @Column({ length: 255, nullable: true })
  siteUrl: string;

  @Column({ length: 150, nullable: true })
  faturamentoMedio: string;

  @Column({ type: 'text', nullable: true })
  comoAjudar: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
