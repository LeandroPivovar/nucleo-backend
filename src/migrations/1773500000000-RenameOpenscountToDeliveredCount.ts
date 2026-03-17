import { MigrationInterface, QueryRunner } from 'typeorm';

export class RenameOpenscountToDeliveredCount1773500000000 implements MigrationInterface {
    name = 'RenameOpenscountToDeliveredCount1773500000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE \`campaigns\` CHANGE \`opensCount\` \`deliveredCount\` int NOT NULL DEFAULT '0'`
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE \`campaigns\` CHANGE \`deliveredCount\` \`opensCount\` int NOT NULL DEFAULT '0'`
        );
    }
}
