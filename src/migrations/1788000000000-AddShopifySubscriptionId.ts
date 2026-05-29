import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddShopifySubscriptionId1788000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('subscriptions');
    if (!table) return;

    if (!table.findColumnByName('shopifySubscriptionId')) {
      await queryRunner.addColumn('subscriptions', new TableColumn({
        name: 'shopifySubscriptionId',
        type: 'varchar',
        length: '255',
        isNullable: true,
      }));
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('subscriptions');
    if (!table) return;

    if (table.findColumnByName('shopifySubscriptionId')) {
      await queryRunner.dropColumn('subscriptions', 'shopifySubscriptionId');
    }
  }
}
