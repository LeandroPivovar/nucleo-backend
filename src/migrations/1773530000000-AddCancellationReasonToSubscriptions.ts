import { MigrationInterface, QueryRunner } from "typeorm";

export class AddCancellationReasonToSubscriptions1773530000000 implements MigrationInterface {
    name = 'AddCancellationReasonToSubscriptions1773530000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`subscriptions\` ADD \`cancellationReason\` varchar(255) NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`subscriptions\` DROP COLUMN \`cancellationReason\``);
    }
}
