import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddBirthDateAndGenderToContacts1773250599727 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('contacts');
    if (!table) return;

    if (!table.findColumnByName('birthDate')) {
      await queryRunner.addColumn('contacts', new TableColumn({
        name: "birthDate",
        type: "date",
        isNullable: true
      }));
    }

    if (!table.findColumnByName('gender')) {
      await queryRunner.addColumn('contacts', new TableColumn({
        name: "gender",
        type: "varchar",
        length: "1",
        isNullable: true
      }));
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('contacts');
    if (!table) return;

    if (table.findColumnByName('gender')) {
      await queryRunner.dropColumn('contacts', 'gender');
    }

    if (table.findColumnByName('birthDate')) {
      await queryRunner.dropColumn('contacts', 'birthDate');
    }
  }
}
