import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddStateAndCityToContacts1700000000007 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'contacts',
      new TableColumn({
        name: 'state',
        type: 'varchar',
        length: '2',
        isNullable: true,
      }),
    );

    await queryRunner.addColumn(
      'contacts',
      new TableColumn({
        name: 'city',
        type: 'varchar',
        length: '100',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('contacts', 'city');
    await queryRunner.dropColumn('contacts', 'state');
  }
}

