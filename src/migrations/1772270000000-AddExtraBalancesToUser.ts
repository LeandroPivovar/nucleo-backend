import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddExtraBalancesToUser1772270000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        const table = await queryRunner.getTable('users');
        if (!table) return;

        if (!table.findColumnByName('extraEmailsBalance')) {
            await queryRunner.addColumn('users', new TableColumn({
                name: 'extraEmailsBalance',
                type: 'int',
                isNullable: false,
                default: 0
            }));
        }

        if (!table.findColumnByName('extraSmsBalance')) {
            await queryRunner.addColumn('users', new TableColumn({
                name: 'extraSmsBalance',
                type: 'int',
                isNullable: false,
                default: 0
            }));
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const table = await queryRunner.getTable('users');
        if (!table) return;

        if (table.findColumnByName('extraSmsBalance')) {
            await queryRunner.dropColumn('users', 'extraSmsBalance');
        }

        if (table.findColumnByName('extraEmailsBalance')) {
            await queryRunner.dropColumn('users', 'extraEmailsBalance');
        }
    }
}
