import { MigrationInterface, QueryRunner, TableColumn } from "typeorm";

export class AddPriceYearlyToPlans1773520000000 implements MigrationInterface {
    name = 'AddPriceYearlyToPlans1773520000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        const table = await queryRunner.getTable('plans');
        if (table && !table.findColumnByName('priceYearly')) {
            await queryRunner.addColumn('plans', new TableColumn({
                name: "priceYearly",
                type: "decimal",
                precision: 10,
                scale: 2,
                isNullable: false,
                default: 0.00
            }));
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const table = await queryRunner.getTable('plans');
        if (table && table.findColumnByName('priceYearly')) {
            await queryRunner.dropColumn('plans', 'priceYearly');
        }
    }

}
