import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateShopifyDataRequests1794000000004 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const exists = await queryRunner.hasTable('shopify_data_requests');
    if (exists) return;

    await queryRunner.createTable(
      new Table({
        name: 'shopify_data_requests',
        columns: [
          { name: 'id', type: 'int', isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
          { name: 'shop', type: 'varchar', length: '255', isNullable: false },
          { name: 'userId', type: 'int', isNullable: true },
          { name: 'shopifyCustomerId', type: 'varchar', length: '100', isNullable: true },
          { name: 'customerEmail', type: 'varchar', length: '255', isNullable: true },
          { name: 'status', type: 'varchar', length: '30', default: "'completed'" },
          { name: 'payload', type: 'json', isNullable: true },
          { name: 'createdAt', type: 'datetime', precision: 6, default: 'CURRENT_TIMESTAMP(6)' },
        ],
      }),
      true,
    );

    await queryRunner.createIndex('shopify_data_requests', new TableIndex({
      name: 'IDX_shopify_data_requests_shop',
      columnNames: ['shop'],
    }));

    await queryRunner.createIndex('shopify_data_requests', new TableIndex({
      name: 'IDX_shopify_data_requests_userId',
      columnNames: ['userId'],
    }));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const exists = await queryRunner.hasTable('shopify_data_requests');
    if (exists) {
      await queryRunner.dropTable('shopify_data_requests');
    }
  }
}
