import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddExtraBalancesToUser1772270000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE \`users\` ADD \`extraEmailsBalance\` int NOT NULL DEFAULT 0`
        );
        await queryRunner.query(
            `ALTER TABLE \`users\` ADD \`extraSmsBalance\` int NOT NULL DEFAULT 0`
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`users\` DROP COLUMN \`extraSmsBalance\``);
        await queryRunner.query(`ALTER TABLE \`users\` DROP COLUMN \`extraEmailsBalance\``);
    }
}
