import { MigrationInterface, QueryRunner } from 'typeorm';

export class src_migrations_AddExternalIdsToProducts1767794188805 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`products\` ADD COLUMN \`externalIds\` JSON NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`products\` DROP COLUMN \`externalIds\``);
  }
}
