import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddRefreshTokenToShopifyConnections1789000000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('shopify_connections');
    if (!table) return;

    if (!table.findColumnByName('refreshToken')) {
      await queryRunner.addColumn('shopify_connections', new TableColumn({
        name: 'refreshToken',
        type: 'text',
        isNullable: true,
      }));
    }

    if (!table.findColumnByName('expiresAt')) {
      await queryRunner.addColumn('shopify_connections', new TableColumn({
        name: 'expiresAt',
        type: 'datetime',
        isNullable: true,
      }));
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('shopify_connections');
    if (!table) return;

    if (table.findColumnByName('expiresAt')) {
      await queryRunner.dropColumn('shopify_connections', 'expiresAt');
    }

    if (table.findColumnByName('refreshToken')) {
      await queryRunner.dropColumn('shopify_connections', 'refreshToken');
    }
  }
}
