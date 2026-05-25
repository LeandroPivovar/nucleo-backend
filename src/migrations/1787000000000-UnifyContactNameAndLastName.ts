import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class UnifyContactNameAndLastName1787000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('contacts');
    if (!table) return;

    if (table.findColumnByName('lastName')) {
      // 1. Unificar o nome e o sobrenome (removendo espaços extras)
      await queryRunner.query(
        "UPDATE contacts SET name = TRIM(CONCAT(name, ' ', COALESCE(lastName, '')))"
      );

      // 2. Remover a coluna lastName
      await queryRunner.dropColumn('contacts', 'lastName');
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('contacts');
    if (!table) return;

    if (!table.findColumnByName('lastName')) {
      await queryRunner.addColumn('contacts', new TableColumn({
        name: 'lastName',
        type: 'varchar',
        length: '100',
        isNullable: true,
      }));
    }
  }
}
