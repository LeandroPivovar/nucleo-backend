import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePixelsAndEventsTable1770869187660 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Tabela de Pixels
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS pixels (
        id INT NOT NULL AUTO_INCREMENT,
        pixelId VARCHAR(36) NOT NULL,
        name VARCHAR(255) NOT NULL,
        userId INT NOT NULL,
        createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updatedAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        UNIQUE INDEX IDX_pixels_pixelId (pixelId),
        PRIMARY KEY (id),
        CONSTRAINT FK_pixels_userId FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);

    // Tabela de Eventos
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS pixel_events (
        id INT NOT NULL AUTO_INCREMENT,
        pixelId VARCHAR(36) NOT NULL,
        event VARCHAR(50) NOT NULL,
        data JSON NULL,
        url TEXT NULL,
        userAgent TEXT NULL,
        ip VARCHAR(45) NULL,
        sessionId VARCHAR(100) NULL,
        timestamp BIGINT NOT NULL,
        createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        INDEX IDX_events_pixelId (pixelId),
        INDEX IDX_events_event (event),
        INDEX IDX_events_timestamp (timestamp),
        PRIMARY KEY (id)
      ) ENGINE=InnoDB
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS pixel_events`);
    await queryRunner.query(`DROP TABLE IF EXISTS pixels`);
  }
}
