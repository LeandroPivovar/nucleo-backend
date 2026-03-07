import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPostalCodeToUsers1772600000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
      ALTER TABLE users
        ADD COLUMN \`postalCode\` VARCHAR(20) NULL
    `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
      ALTER TABLE users
        DROP COLUMN \`postalCode\`
    `);
    }
}
