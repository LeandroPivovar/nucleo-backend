import { MigrationInterface, QueryRunner, TableColumn } from "typeorm";

export class AddVisibleToPlans1785000000000 implements MigrationInterface {
    name = 'AddVisibleToPlans1785000000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        const table = await queryRunner.getTable('plans');
        if (table && !table.findColumnByName('visible')) {
            await queryRunner.addColumn('plans', new TableColumn({
                name: "visible",
                type: "tinyint",
                isNullable: false,
                default: 1
            }));
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const table = await queryRunner.getTable('plans');
        if (table && table.findColumnByName('visible')) {
            await queryRunner.dropColumn('plans', 'visible');
        }
    }
}
