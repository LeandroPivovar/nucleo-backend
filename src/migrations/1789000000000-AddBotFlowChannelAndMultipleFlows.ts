import { MigrationInterface, QueryRunner, TableIndex } from 'typeorm';

export class AddBotFlowChannelAndMultipleFlows1789000000000 implements MigrationInterface {
  private async ensureColumns(queryRunner: QueryRunner): Promise<void> {
    let table = await queryRunner.getTable('bot_flows');
    if (!table) return;

    if (!table.findColumnByName('name')) {
      await queryRunner.query(`
        ALTER TABLE \`bot_flows\`
        ADD COLUMN \`name\` varchar(150) NOT NULL DEFAULT 'Novo fluxo'
      `);
    }

    if (!table.findColumnByName('channel')) {
      await queryRunner.query(`
        ALTER TABLE \`bot_flows\`
        ADD COLUMN \`channel\` varchar(50) NOT NULL DEFAULT 'whatsapp_qr'
      `);
    }
  }

  /** Remove UNIQUE em userId (permite vários fluxos) mantendo FK. */
  private async convertUserIdIndexToNonUnique(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('bot_flows');
    if (!table) return;

    const userIdIndex = table.indices.find((i) => i.name === 'IDX_bot_flows_userId');
    if (!userIdIndex?.isUnique) {
      return;
    }

    await queryRunner.query(`
      ALTER TABLE \`bot_flows\` DROP FOREIGN KEY \`FK_bot_flows_userId\`
    `);
    await queryRunner.query(`
      ALTER TABLE \`bot_flows\` DROP INDEX \`IDX_bot_flows_userId\`
    `);
    await queryRunner.query(`
      CREATE INDEX \`IDX_bot_flows_userId\` ON \`bot_flows\` (\`userId\`)
    `);
    await queryRunner.query(`
      ALTER TABLE \`bot_flows\`
      ADD CONSTRAINT \`FK_bot_flows_userId\`
      FOREIGN KEY (\`userId\`) REFERENCES \`users\`(\`id\`)
      ON DELETE CASCADE ON UPDATE NO ACTION
    `);
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.ensureColumns(queryRunner);
    await this.convertUserIdIndexToNonUnique(queryRunner);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('bot_flows');
    if (!table) return;

    const userIdIndex = table.indices.find((i) => i.name === 'IDX_bot_flows_userId');
    if (userIdIndex && !userIdIndex.isUnique) {
      await queryRunner.query(`
        ALTER TABLE \`bot_flows\` DROP FOREIGN KEY \`FK_bot_flows_userId\`
      `);
      await queryRunner.query(`
        ALTER TABLE \`bot_flows\` DROP INDEX \`IDX_bot_flows_userId\`
      `);
      await queryRunner.createIndex(
        'bot_flows',
        new TableIndex({
          name: 'IDX_bot_flows_userId',
          columnNames: ['userId'],
          isUnique: true,
        }),
      );
      await queryRunner.query(`
        ALTER TABLE \`bot_flows\`
        ADD CONSTRAINT \`FK_bot_flows_userId\`
        FOREIGN KEY (\`userId\`) REFERENCES \`users\`(\`id\`)
        ON DELETE CASCADE ON UPDATE NO ACTION
      `);
    }

    if (table.findColumnByName('channel')) {
      await queryRunner.query(`ALTER TABLE \`bot_flows\` DROP COLUMN \`channel\``);
    }
    if (table.findColumnByName('name')) {
      await queryRunner.query(`ALTER TABLE \`bot_flows\` DROP COLUMN \`name\``);
    }
  }
}
