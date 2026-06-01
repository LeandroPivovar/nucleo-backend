import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGeminiSettingsAndBotSessions1791000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO system_settings (\`key\`, \`value\`, description)
      SELECT 'GEMINI_API_KEY', '', 'Chave da API Google Gemini para bots com IA'
      WHERE NOT EXISTS (SELECT 1 FROM system_settings WHERE \`key\` = 'GEMINI_API_KEY')
    `);

    await queryRunner.query(`
      INSERT INTO system_settings (\`key\`, \`value\`, description)
      SELECT 'GEMINI_MODEL', 'gemini-2.0-flash', 'Modelo Gemini (ex: gemini-2.0-flash)'
      WHERE NOT EXISTS (SELECT 1 FROM system_settings WHERE \`key\` = 'GEMINI_MODEL')
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`bot_conversation_sessions\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`botFlowId\` INT NOT NULL,
        \`chatId\` VARCHAR(64) NOT NULL,
        \`currentNodeId\` VARCHAR(100) NULL,
        \`waitingAtNodeId\` VARCHAR(100) NULL,
        \`status\` VARCHAR(20) NOT NULL DEFAULT 'active',
        \`history\` JSON NULL,
        \`createdAt\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updatedAt\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE INDEX \`UQ_bot_sessions_flow_chat\` (\`botFlowId\`, \`chatId\`),
        CONSTRAINT \`FK_bot_sessions_flow\` FOREIGN KEY (\`botFlowId\`) REFERENCES \`bot_flows\`(\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS `bot_conversation_sessions`;');
    await queryRunner.query(`DELETE FROM system_settings WHERE \`key\` IN ('GEMINI_API_KEY', 'GEMINI_MODEL')`);
  }
}
