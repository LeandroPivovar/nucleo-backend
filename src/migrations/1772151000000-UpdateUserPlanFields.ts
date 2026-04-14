import { MigrationInterface, QueryRunner, TableColumn } from "typeorm";

export class UpdateUserPlanFields1772151000000 implements MigrationInterface {
    name = 'UpdateUserPlanFields1772151000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        const table = await queryRunner.getTable('users');
        if (!table) return;

        if (!table.findColumnByName('planId')) {
            await queryRunner.addColumn('users', new TableColumn({
                name: 'planId',
                type: 'int',
                isNullable: true
            }));
        }

        if (!table.findColumnByName('subscriptionStatus')) {
            await queryRunner.addColumn('users', new TableColumn({
                name: 'subscriptionStatus',
                type: 'varchar',
                length: '50',
                isNullable: true
            }));
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const table = await queryRunner.getTable('users');
        if (!table) return;

        if (table.findColumnByName('subscriptionStatus')) {
            await queryRunner.dropColumn('users', 'subscriptionStatus');
        }

        if (table.findColumnByName('planId')) {
            await queryRunner.dropColumn('users', 'planId');
        }
    }
}
