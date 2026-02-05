import { MigrationInterface, QueryRunner } from "typeorm";

export class AddEmailsSentMonthToUser1770265712559 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`users\` ADD \`emailsSentMonth\` int NOT NULL DEFAULT '0'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`users\` DROP COLUMN \`emailsSentMonth\``);
    }

}
