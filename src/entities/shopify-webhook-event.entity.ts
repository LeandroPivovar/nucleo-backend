import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * Registro de webhooks já processados, para deduplicação.
 *
 * A Shopify reentrega webhooks quando não recebe 200 a tempo (e pode entregar
 * o mesmo evento mais de uma vez mesmo em caso de sucesso). Sem dedupe, uma
 * reentrega de orders/create duplicaria vendas e reprocessaria campanhas.
 * O `webhookId` é o header X-Shopify-Webhook-Id, único por evento.
 */
@Entity('shopify_webhook_events')
export class ShopifyWebhookEvent {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column({ length: 100 })
  webhookId: string;

  @Column({ length: 100, nullable: true })
  topic: string;

  @Column({ length: 255, nullable: true })
  shop: string;

  @Index()
  @CreateDateColumn()
  createdAt: Date;
}
