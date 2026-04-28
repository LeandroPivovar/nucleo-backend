import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLeadRequestFields1777419111067 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`lead_requests\` 
      ADD \`segmento\` varchar(150) NULL,
      ADD \`canalVendas\` varchar(150) NULL,
      ADD \`instagram\` varchar(150) NULL,
      ADD \`siteUrl\` varchar(255) NULL,
      ADD \`faturamentoMedio\` varchar(150) NULL,
      ADD \`comoAjudar\` text NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`lead_requests\` 
      DROP COLUMN \`comoAjudar\`,
      DROP COLUMN \`faturamentoMedio\`,
      DROP COLUMN \`siteUrl\`,
      DROP COLUMN \`instagram\`,
      DROP COLUMN \`canalVendas\`,
      DROP COLUMN \`segmento\`
    `);
  }
}
