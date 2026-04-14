import { MigrationInterface, QueryRunner, TableColumn } from "typeorm";

export class AddEmailsSentMonthToUser1770265712559 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        const table = await queryRunner.getTable('users');
        if (table && !table.findColumnByName('emailsSentMonth')) {
            await queryRunner.addColumn('users', new TableColumn({
                name: "emailsSentMonth",
                type: "int",
                isNullable: false,
                default: 0
            }));
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const table = await queryRunner.getTable('users');
        if (table && table.findColumnByName('emailsSentMonth')) {
            await queryRunner.dropColumn('users', 'emailsSentMonth');
        }
    }

}
