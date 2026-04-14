import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class src_migrations_AddExternalIdsToProducts1767794188805 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('products');
    if (table && !table.findColumnByName('externalIds')) {
      await queryRunner.addColumn('products', new TableColumn({
        name: "externalIds",
        type: "json",
        isNullable: true
      }));
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('products');
    if (table && table.findColumnByName('externalIds')) {
      await queryRunner.dropColumn('products', 'externalIds');
    }
  }
}
