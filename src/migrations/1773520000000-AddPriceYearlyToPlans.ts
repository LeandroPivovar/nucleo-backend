import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPriceYearlyToPlans1773520000000 implements MigrationInterface {
    name = 'AddPriceYearlyToPlans1773520000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`plans\` ADD \`priceYearly\` decimal(10,2) NOT NULL DEFAULT '0.00'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`plans\` DROP COLUMN \`priceYearly\``);
    }

}
