import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBotTelegramConnectionsTable1790000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`bot_telegram_connections\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`botFlowId\` INT NOT NULL,
        \`userId\` INT NOT NULL,
        \`botToken\` TEXT NOT NULL,
        \`telegramBotId\` VARCHAR(32) NOT NULL,
        \`botUsername\` VARCHAR(255) NULL,
        \`webhookSecret\` VARCHAR(64) NOT NULL,
        \`status\` VARCHAR(20) NOT NULL DEFAULT 'connected',
        \`connectedAt\` DATETIME NULL,
        \`createdAt\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updatedAt\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE INDEX \`UQ_bot_telegram_connections_botFlowId\` (\`botFlowId\`),
        UNIQUE INDEX \`UQ_bot_telegram_connections_telegramBotId\` (\`telegramBotId\`),
        CONSTRAINT \`FK_bot_telegram_connections_botFlow\` FOREIGN KEY (\`botFlowId\`) REFERENCES \`bot_flows\`(\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`FK_bot_telegram_connections_user\` FOREIGN KEY (\`userId\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS `bot_telegram_connections`;');
  }
}
