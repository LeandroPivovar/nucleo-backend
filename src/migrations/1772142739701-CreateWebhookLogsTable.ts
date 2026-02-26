import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateWebhookLogsTable1772142739701 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE webhook_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        url VARCHAR(255) NOT NULL,
        method VARCHAR(10) NOT NULL,
        headers JSON NULL,
        payload JSON NULL,
        source VARCHAR(50) NULL,
        createdAt DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
        INDEX idx_webhook_logs_url (url),
        INDEX idx_webhook_logs_source (source)
      ) ENGINE=InnoDB
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE webhook_logs`);
  }
}
