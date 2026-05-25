import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddCpfCnpjToContacts1786000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('contacts');
    if (!table) return;

    if (!table.findColumnByName('cpfCnpj')) {
      await queryRunner.addColumn('contacts', new TableColumn({
        name: "cpfCnpj",
        type: "varchar",
        length: "20",
        isNullable: true
      }));
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('contacts');
    if (!table) return;

    if (table.findColumnByName('cpfCnpj')) {
      await queryRunner.dropColumn('contacts', 'cpfCnpj');
    }
  }
}
