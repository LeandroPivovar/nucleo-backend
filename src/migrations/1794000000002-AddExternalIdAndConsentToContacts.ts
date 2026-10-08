import { MigrationInterface, QueryRunner, TableColumn, TableIndex } from 'typeorm';

export class AddExternalIdAndConsentToContacts1794000000002 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('contacts');
    if (!table) return;

    if (!table.findColumnByName('externalId')) {
      await queryRunner.addColumn('contacts', new TableColumn({
        name: 'externalId',
        type: 'varchar',
        length: '100',
        isNullable: true,
      }));

      await queryRunner.createIndex('contacts', new TableIndex({
        name: 'IDX_contacts_externalId',
        columnNames: ['externalId'],
      }));
    }

    if (!table.findColumnByName('emailOptIn')) {
      await queryRunner.addColumn('contacts', new TableColumn({
        name: 'emailOptIn',
        type: 'tinyint',
        width: 1,
        isNullable: true,
      }));
    }

    if (!table.findColumnByName('smsOptIn')) {
      await queryRunner.addColumn('contacts', new TableColumn({
        name: 'smsOptIn',
        type: 'tinyint',
        width: 1,
        isNullable: true,
      }));
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('contacts');
    if (!table) return;

    if (table.findColumnByName('smsOptIn')) {
      await queryRunner.dropColumn('contacts', 'smsOptIn');
    }
    if (table.findColumnByName('emailOptIn')) {
      await queryRunner.dropColumn('contacts', 'emailOptIn');
    }
    if (table.findColumnByName('externalId')) {
      await queryRunner.dropIndex('contacts', 'IDX_contacts_externalId');
      await queryRunner.dropColumn('contacts', 'externalId');
    }
  }
}
