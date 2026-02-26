import { MigrationInterface, QueryRunner } from 'typeorm';

export class src_migrations_AddDocumentAddressToUser1772059712096 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users
        ADD COLUMN \`document\` VARCHAR(20) NULL,
        ADD COLUMN \`address\` VARCHAR(255) NULL,
        ADD COLUMN \`referralCode\` VARCHAR(20) NULL UNIQUE,
        ADD COLUMN \`referredById\` INT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users
        DROP COLUMN \`referredById\`,
        DROP COLUMN \`referralCode\`,
        DROP COLUMN \`address\`,
        DROP COLUMN \`document\`
    `);
  }
}
