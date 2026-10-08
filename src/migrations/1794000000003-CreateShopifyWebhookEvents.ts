import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateShopifyWebhookEvents1794000000003 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const exists = await queryRunner.hasTable('shopify_webhook_events');
    if (exists) return;

    await queryRunner.createTable(
      new Table({
        name: 'shopify_webhook_events',
        columns: [
          { name: 'id', type: 'int', isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
          { name: 'webhookId', type: 'varchar', length: '100', isNullable: false },
          { name: 'topic', type: 'varchar', length: '100', isNullable: true },
          { name: 'shop', type: 'varchar', length: '255', isNullable: true },
          { name: 'createdAt', type: 'datetime', precision: 6, default: 'CURRENT_TIMESTAMP(6)' },
        ],
      }),
      true,
    );

    await queryRunner.createIndex('shopify_webhook_events', new TableIndex({
      name: 'UQ_shopify_webhook_events_webhookId',
      columnNames: ['webhookId'],
      isUnique: true,
    }));

    await queryRunner.createIndex('shopify_webhook_events', new TableIndex({
      name: 'IDX_shopify_webhook_events_createdAt',
      columnNames: ['createdAt'],
    }));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const exists = await queryRunner.hasTable('shopify_webhook_events');
    if (exists) {
      await queryRunner.dropTable('shopify_webhook_events');
    }
  }
}
