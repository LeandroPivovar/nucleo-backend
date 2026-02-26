import { MigrationInterface, QueryRunner, Table, TableColumn } from "typeorm";

export class AsaasAndSystemSettings1772473000000 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Create system_settings table
        await queryRunner.createTable(new Table({
            name: "system_settings",
            columns: [
                {
                    name: "id",
                    type: "int",
                    isPrimary: true,
                    isGenerated: true,
                    generationStrategy: "increment"
                },
                {
                    name: "key",
                    type: "varchar",
                    length: "100",
                    isUnique: true
                },
                {
                    name: "value",
                    type: "text",
                    isNullable: true
                },
                {
                    name: "description",
                    type: "varchar",
                    length: "255",
                    isNullable: true
                },
                {
                    name: "createdAt",
                    type: "timestamp",
                    default: "CURRENT_TIMESTAMP"
                },
                {
                    name: "updatedAt",
                    type: "timestamp",
                    default: "CURRENT_TIMESTAMP",
                    onUpdate: "CURRENT_TIMESTAMP"
                }
            ]
        }), true);

        // Add asaasCustomerId to users
        await queryRunner.addColumn("users", new TableColumn({
            name: "asaasCustomerId",
            type: "varchar",
            length: "50",
            isNullable: true
        }));

        // Add asaasSubscriptionId to subscriptions
        await queryRunner.addColumn("subscriptions", new TableColumn({
            name: "asaasSubscriptionId",
            type: "varchar",
            length: "50",
            isNullable: true
        }));

        // Seed initial Asaas settings
        await queryRunner.query(`
            INSERT INTO system_settings (\`key\`, \`value\`, description) VALUES 
            ('ASAAS_API_KEY', '', 'Chave da API do Asaas'),
            ('ASAAS_WEBHOOK_TOKEN', '', 'Token de autenticação do Webhook do Asaas'),
            ('ASAAS_ENVIRONMENT', 'sandbox', 'Ambiente do Asaas (sandbox ou production)')
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropColumn("subscriptions", "asaasSubscriptionId");
        await queryRunner.dropColumn("users", "asaasCustomerId");
        await queryRunner.dropTable("system_settings");
    }

}
