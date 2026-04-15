import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateTwilioConnectionsTable1776281716935 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS \`twilio_connections\` (
                \`id\` INT AUTO_INCREMENT PRIMARY KEY,
                \`userId\` INT NOT NULL,
                \`friendlyName\` VARCHAR(255),
                \`whatsappFrom\` VARCHAR(255) NOT NULL,
                \`accountSid\` VARCHAR(255),
                \`authToken\` TEXT,
                \`status\` VARCHAR(50) NOT NULL DEFAULT 'pending',
                \`adminNote\` TEXT,
                \`createdAt\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                \`updatedAt\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                CONSTRAINT \`FK_twilio_connections_user\` FOREIGN KEY (\`userId\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query("DROP TABLE IF EXISTS `twilio_connections`;");
    }

}
