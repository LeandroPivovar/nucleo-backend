import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * Solicitação de dados de um cliente (webhook customers/data_request).
 *
 * A Shopify exige que o app entregue ao merchant, em até 30 dias, tudo o que
 * guarda sobre o cliente. O export fica aqui (não em arquivo público) e o
 * merchant baixa por endpoint autenticado — o registro também é a trilha de
 * auditoria da solicitação.
 */
@Entity('shopify_data_requests')
export class ShopifyDataRequest {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ length: 255 })
  shop: string;

  // Dono da conexão no CRM (quem pode baixar o export).
  @Index()
  @Column({ type: 'int', nullable: true })
  userId: number | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  shopifyCustomerId: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  customerEmail: string | null;

  // 'completed' = export gerado; 'no_data' = nada encontrado sobre o cliente.
  @Column({ length: 30, default: 'completed' })
  status: string;

  @Column({ type: 'json', nullable: true })
  payload: any;

  @CreateDateColumn()
  createdAt: Date;
}
