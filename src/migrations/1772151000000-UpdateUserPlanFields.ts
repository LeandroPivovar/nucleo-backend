import { MigrationInterface, QueryRunner } from "typeorm";

export class UpdateUserPlanFields1772151000000 implements MigrationInterface {
    name = 'UpdateUserPlanFields1772151000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`users\` ADD \`planId\` int NULL`);
        await queryRunner.query(`ALTER TABLE \`users\` ADD \`subscriptionStatus\` varchar(50) NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`users\` DROP COLUMN \`subscriptionStatus\``);
        await queryRunner.query(`ALTER TABLE \`users\` DROP COLUMN \`planId\``);
    }
}
