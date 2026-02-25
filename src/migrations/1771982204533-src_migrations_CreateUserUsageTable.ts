import { MigrationInterface, QueryRunner } from 'typeorm';

export class src_migrations_CreateUserUsageTable1771982204533 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Adicione suas alterações aqui
    // Exemplo: await queryRunner.query(`ALTER TABLE users ADD COLUMN newColumn VARCHAR(255)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Adicione a reversão aqui
    // Exemplo: await queryRunner.query(`ALTER TABLE users DROP COLUMN newColumn`);
  }
}
