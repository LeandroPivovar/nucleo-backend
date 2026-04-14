import { MigrationInterface, QueryRunner, TableColumn } from "typeorm";

export class AddTwoFactorToUser1772550000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        const table = await queryRunner.getTable('users');
        if (!table) return;

        if (!table.findColumnByName('twoFactorEnabled')) {
            await queryRunner.addColumn('users', new TableColumn({
                name: 'twoFactorEnabled',
                type: 'tinyint',
                isNullable: false,
                default: 0,
            }));
        }

        if (!table.findColumnByName('twoFactorCode')) {
            await queryRunner.addColumn('users', new TableColumn({
                name: 'twoFactorCode',
                type: 'varchar',
                length: '10',
                isNullable: true,
            }));
        }

        if (!table.findColumnByName('twoFactorExpires')) {
            await queryRunner.addColumn('users', new TableColumn({
                name: 'twoFactorExpires',
                type: 'datetime',
                isNullable: true,
            }));
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const table = await queryRunner.getTable('users');
        if (!table) return;

        if (table.findColumnByName('twoFactorEnabled')) {
            await queryRunner.dropColumn('users', 'twoFactorEnabled');
        }

        if (table.findColumnByName('twoFactorCode')) {
            await queryRunner.dropColumn('users', 'twoFactorCode');
        }

        if (table.findColumnByName('twoFactorExpires')) {
            await queryRunner.dropColumn('users', 'twoFactorExpires');
        }
    }
}
