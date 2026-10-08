import { MigrationInterface, QueryRunner, TableColumn, TableIndex } from 'typeorm';

export class AddUserIdToWebhookLogs1794000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('webhook_logs');
    if (!table) return;

    if (!table.findColumnByName('userId')) {
      await queryRunner.addColumn('webhook_logs', new TableColumn({
        name: 'userId',
        type: 'int',
        isNullable: true,
      }));

      await queryRunner.createIndex('webhook_logs', new TableIndex({
        name: 'IDX_webhook_logs_userId',
        columnNames: ['userId'],
      }));
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('webhook_logs');
    if (!table) return;

    if (table.findColumnByName('userId')) {
      await queryRunner.dropIndex('webhook_logs', 'IDX_webhook_logs_userId');
      await queryRunner.dropColumn('webhook_logs', 'userId');
    }
  }
}
