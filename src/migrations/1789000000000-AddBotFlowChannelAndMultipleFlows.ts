import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBotFlowChannelAndMultipleFlows1789000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`bot_flows\`
      ADD COLUMN \`name\` varchar(150) NOT NULL DEFAULT 'Novo fluxo',
      ADD COLUMN \`channel\` varchar(50) NOT NULL DEFAULT 'whatsapp_qr'
    `);

    try {
      await queryRunner.query(`
        ALTER TABLE \`bot_flows\` DROP INDEX \`IDX_bot_flows_userId\`
      `);
    } catch {
      // índice pode não existir em ambientes diferentes
    }

    await queryRunner.query(`
      CREATE INDEX \`IDX_bot_flows_userId\` ON \`bot_flows\` (\`userId\`)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    try {
      await queryRunner.query(`
        ALTER TABLE \`bot_flows\` DROP INDEX \`IDX_bot_flows_userId\`
      `);
    } catch {
      // ignore
    }

    await queryRunner.query(`
      CREATE UNIQUE INDEX \`IDX_bot_flows_userId\` ON \`bot_flows\` (\`userId\`)
    `);

    await queryRunner.query(`
      ALTER TABLE \`bot_flows\`
      DROP COLUMN \`channel\`,
      DROP COLUMN \`name\`
    `);
  }
}
