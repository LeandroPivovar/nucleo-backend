import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBotFlowEntity1780306999285 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`bot_flows\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`userId\` int NOT NULL,
        \`nodes\` json NULL,
        \`edges\` json NULL,
        \`isActive\` tinyint NOT NULL DEFAULT 0,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`IDX_bot_flows_userId\` (\`userId\`),
        CONSTRAINT \`FK_bot_flows_userId\` FOREIGN KEY (\`userId\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION
      ) ENGINE=InnoDB
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`bot_flows\` DROP FOREIGN KEY \`FK_bot_flows_userId\``);
    await queryRunner.query(`DROP TABLE \`bot_flows\``);
  }
}
