import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBirthDateAndGenderToContacts1773250599727 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`contacts\` ADD COLUMN \`birthDate\` DATE NULL`);
    await queryRunner.query(`ALTER TABLE \`contacts\` ADD COLUMN \`gender\` VARCHAR(1) NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`contacts\` DROP COLUMN \`birthDate\``);
    await queryRunner.query(`ALTER TABLE \`contacts\` DROP COLUMN \`gender\``);
  }
}
