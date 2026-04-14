import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class src_migrations_AddDocumentAddressToUser1772059712096 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('users');
    if (!table) return;

    if (!table.findColumnByName('document')) {
      await queryRunner.addColumn('users', new TableColumn({
        name: "document",
        type: "varchar",
        length: "20",
        isNullable: true
      }));
    }

    if (!table.findColumnByName('address')) {
      await queryRunner.addColumn('users', new TableColumn({
        name: "address",
        type: "varchar",
        length: "255",
        isNullable: true
      }));
    }

    if (!table.findColumnByName('referralCode')) {
      await queryRunner.addColumn('users', new TableColumn({
        name: "referralCode",
        type: "varchar",
        length: "20",
        isNullable: true,
        isUnique: true
      }));
    }

    if (!table.findColumnByName('referredById')) {
      await queryRunner.addColumn('users', new TableColumn({
        name: "referredById",
        type: "int",
        isNullable: true
      }));
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('users');
    if (!table) return;

    if (table.findColumnByName('referredById')) {
      await queryRunner.dropColumn('users', 'referredById');
    }

    if (table.findColumnByName('referralCode')) {
      await queryRunner.dropColumn('users', 'referralCode');
    }

    if (table.findColumnByName('address')) {
      await queryRunner.dropColumn('users', 'address');
    }

    if (table.findColumnByName('document')) {
      await queryRunner.dropColumn('users', 'document');
    }
  }
}
