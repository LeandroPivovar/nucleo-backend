import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateLeadRequestsTable1775578319576 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`lead_requests\` (
        \`id\` int(11) NOT NULL AUTO_INCREMENT,
        \`name\` varchar(150) NOT NULL,
        \`email\` varchar(255) NOT NULL,
        \`phone\` varchar(30) NOT NULL,
        \`company\` varchar(150) NOT NULL,
        \`source\` varchar(100) DEFAULT NULL,
        \`status\` enum('pending','contact_sent','no_response','converted','meeting_scheduled') NOT NULL DEFAULT 'pending',
        \`adminNote\` text DEFAULT NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`lead_requests\``);
  }
}
