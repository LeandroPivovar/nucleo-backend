import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddPriceUsdToPlans1794000000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('plans');
    if (!table) return;

    if (!table.findColumnByName('priceUsd')) {
      await queryRunner.addColumn('plans', new TableColumn({
        name: 'priceUsd',
        type: 'decimal',
        precision: 10,
        scale: 2,
        isNullable: true,
      }));
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('plans');
    if (!table) return;

    if (table.findColumnByName('priceUsd')) {
      await queryRunner.dropColumn('plans', 'priceUsd');
    }
  }
}
