import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderWaitFieldsToCampaignQueue1783000000000 implements MigrationInterface {
    name = 'AddOrderWaitFieldsToCampaignQueue1783000000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Tipo da fila: 'delay' ou 'order_wait'
        await queryRunner.query(`
            ALTER TABLE \`campaign_queue\`
            ADD COLUMN \`type\` VARCHAR(30) NOT NULL DEFAULT 'delay'
        `);

        // ID do nó de condição que está sendo aguardado
        await queryRunner.query(`
            ALTER TABLE \`campaign_queue\`
            ADD COLUMN \`waiting_node_id\` VARCHAR(100) NULL
        `);

        // Quando a campanha iniciou (para calcular intervalos decrescentes)
        await queryRunner.query(`
            ALTER TABLE \`campaign_queue\`
            ADD COLUMN \`campaign_started_at\` DATETIME NULL
        `);

        // Quando foi a última verificação de pedidos
        await queryRunner.query(`
            ALTER TABLE \`campaign_queue\`
            ADD COLUMN \`last_checked_at\` DATETIME NULL
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`campaign_queue\` DROP COLUMN \`last_checked_at\``);
        await queryRunner.query(`ALTER TABLE \`campaign_queue\` DROP COLUMN \`campaign_started_at\``);
        await queryRunner.query(`ALTER TABLE \`campaign_queue\` DROP COLUMN \`waiting_node_id\``);
        await queryRunner.query(`ALTER TABLE \`campaign_queue\` DROP COLUMN \`type\``);
    }
}
