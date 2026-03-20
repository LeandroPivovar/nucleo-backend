import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCampaignQueue1773530000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE \`campaign_queue\` (
                \`id\` int NOT NULL AUTO_INCREMENT,
                \`user_id\` int NOT NULL,
                \`campaign_id\` int NOT NULL,
                \`contact_id\` int NOT NULL,
                \`delay_node_id\` varchar(100) NOT NULL,
                \`resume_at\` datetime NOT NULL,
                \`eventContext\` json,
                \`status\` varchar(50) NOT NULL DEFAULT 'pending',
                \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
                \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
                PRIMARY KEY (\`id\`),
                KEY \`FK_CQ_User\` (\`user_id\`),
                KEY \`FK_CQ_Campaign\` (\`campaign_id\`),
                KEY \`FK_CQ_Contact\` (\`contact_id\`),
                CONSTRAINT \`FK_CQ_User\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE,
                CONSTRAINT \`FK_CQ_Campaign\` FOREIGN KEY (\`campaign_id\`) REFERENCES \`campaigns\`(\`id\`) ON DELETE CASCADE,
                CONSTRAINT \`FK_CQ_Contact\` FOREIGN KEY (\`contact_id\`) REFERENCES \`contacts\`(\`id\`) ON DELETE CASCADE
            ) ENGINE=InnoDB
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE \`campaign_queue\``);
    }
}
