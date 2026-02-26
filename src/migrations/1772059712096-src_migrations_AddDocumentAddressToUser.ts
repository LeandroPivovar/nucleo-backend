import { MigrationInterface, QueryRunner } from 'typeorm';

export class src_migrations_AddDocumentAddressToUser1772059712096 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS \`document\` VARCHAR(20) NULL,
        ADD COLUMN IF NOT EXISTS \`address\` VARCHAR(255) NULL,
        ADD COLUMN IF NOT EXISTS \`referralCode\` VARCHAR(20) NULL UNIQUE,
        ADD COLUMN IF NOT EXISTS \`referredById\` INT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users
        DROP COLUMN IF EXISTS \`referredById\`,
        DROP COLUMN IF EXISTS \`referralCode\`,
        DROP COLUMN IF EXISTS \`address\`,
        DROP COLUMN IF EXISTS \`document\`
    `);
  }
}
