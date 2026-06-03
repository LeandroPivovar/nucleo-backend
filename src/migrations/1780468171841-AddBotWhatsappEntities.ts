import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBotWhatsappEntities1780468171841 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`bot_whatsapp_sessions\` (
        \`sessionId\` varchar(255) NOT NULL,
        \`sessionData\` longtext NOT NULL,
        PRIMARY KEY (\`sessionId\`)
      ) ENGINE=InnoDB
    `);

    await queryRunner.query(`
      CREATE TABLE \`bot_whatsapp_connections\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`botFlowId\` int NOT NULL,
        \`userId\` int NOT NULL,
        \`status\` varchar(20) NOT NULL DEFAULT 'disconnected',
        \`qrCode\` text NULL,
        \`botPhoneNumber\` varchar(255) NULL,
        \`connectedAt\` datetime NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        UNIQUE INDEX \`IDX_bot_whatsapp_flow_id\` (\`botFlowId\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB
    `);

    await queryRunner.query(`
      ALTER TABLE \`bot_whatsapp_connections\`
      ADD CONSTRAINT \`FK_bot_whatsapp_flow\`
      FOREIGN KEY (\`botFlowId\`) REFERENCES \`bot_flows\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE \`bot_whatsapp_connections\`
      ADD CONSTRAINT \`FK_bot_whatsapp_user\`
      FOREIGN KEY (\`userId\`) REFERENCES \`users\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`bot_whatsapp_connections\` DROP FOREIGN KEY \`FK_bot_whatsapp_user\``);
    await queryRunner.query(`ALTER TABLE \`bot_whatsapp_connections\` DROP FOREIGN KEY \`FK_bot_whatsapp_flow\``);
    await queryRunner.query(`DROP TABLE \`bot_whatsapp_connections\``);
    await queryRunner.query(`DROP TABLE \`bot_whatsapp_sessions\``);
  }
}
