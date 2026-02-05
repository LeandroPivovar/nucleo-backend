import { MigrationInterface, QueryRunner, Table, TableForeignKey } from "typeorm";

export class CreateSubscriptionsTables1769673917050 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Create Plans Table
        await queryRunner.createTable(new Table({
            name: "plans",
            columns: [
                { name: "id", type: "int", isPrimary: true, isGenerated: true, generationStrategy: "increment" },
                { name: "name", type: "varchar", length: "100" },
                { name: "price", type: "decimal", precision: 10, scale: 2 },
                { name: "interval", type: "varchar", length: "20", default: "'monthly'" },
                { name: "features", type: "json", isNullable: true },
                { name: "limits", type: "json", isNullable: true },
                { name: "active", type: "boolean", default: true },
                { name: "createdAt", type: "timestamp", default: "CURRENT_TIMESTAMP" },
                { name: "updatedAt", type: "timestamp", default: "CURRENT_TIMESTAMP", onUpdate: "CURRENT_TIMESTAMP" }
            ]
        }), true);

        // Create Subscriptions Table
        await queryRunner.createTable(new Table({
            name: "subscriptions",
            columns: [
                { name: "id", type: "int", isPrimary: true, isGenerated: true, generationStrategy: "increment" },
                { name: "userId", type: "int" },
                { name: "planId", type: "int" },
                { name: "status", type: "varchar", length: "50", default: "'active'" },
                { name: "currentPeriodStart", type: "timestamp", isNullable: true },
                { name: "currentPeriodEnd", type: "timestamp", isNullable: true },
                { name: "cancelAtPeriodEnd", type: "boolean", default: false },
                { name: "stripeSubscriptionId", type: "varchar", isNullable: true },
                { name: "createdAt", type: "timestamp", default: "CURRENT_TIMESTAMP" },
                { name: "updatedAt", type: "timestamp", default: "CURRENT_TIMESTAMP", onUpdate: "CURRENT_TIMESTAMP" }
            ]
        }), true);

        // Create Invoices Table
        await queryRunner.createTable(new Table({
            name: "invoices",
            columns: [
                { name: "id", type: "int", isPrimary: true, isGenerated: true, generationStrategy: "increment" },
                { name: "subscriptionId", type: "int", isNullable: true },
                { name: "userId", type: "int" },
                { name: "amount", type: "decimal", precision: 10, scale: 2 },
                { name: "status", type: "varchar", length: "50" },
                { name: "hostedInvoiceUrl", type: "varchar", length: "255", isNullable: true },
                { name: "pdfUrl", type: "varchar", length: "255", isNullable: true },
                { name: "stripeInvoiceId", type: "varchar", isNullable: true },
                { name: "createdAt", type: "timestamp", default: "CURRENT_TIMESTAMP" }
            ]
        }), true);

        // Foreign Keys for Subscriptions
        await queryRunner.createForeignKey("subscriptions", new TableForeignKey({
            columnNames: ["userId"],
            referencedColumnNames: ["id"],
            referencedTableName: "users",
            onDelete: "CASCADE"
        }));

        await queryRunner.createForeignKey("subscriptions", new TableForeignKey({
            columnNames: ["planId"],
            referencedColumnNames: ["id"],
            referencedTableName: "plans",
            onDelete: "RESTRICT"
        }));

        // Foreign Keys for Invoices
        await queryRunner.createForeignKey("invoices", new TableForeignKey({
            columnNames: ["userId"],
            referencedColumnNames: ["id"],
            referencedTableName: "users",
            onDelete: "CASCADE"
        }));

        await queryRunner.createForeignKey("invoices", new TableForeignKey({
            columnNames: ["subscriptionId"],
            referencedColumnNames: ["id"],
            referencedTableName: "subscriptions",
            onDelete: "SET NULL"
        }));

        // Seed Plans
        await queryRunner.query(`
            INSERT INTO plans (name, price, \`interval\`, features, limits, active) VALUES 
            ('Starter', 47.00, 'monthly', '["Até 2.000 contatos", "E-mail marketing", "Templates básicos"]', '{"contacts": 2000, "emails": 10000, "whatsapp": false}', true),
            ('Pro', 97.00, 'monthly', '["Até 10.000 contatos", "Todos os canais", "Analytics avançados", "Automações ilimitadas"]', '{"contacts": 10000, "emails": 50000, "whatsapp": true}', true),
            ('Enterprise', 247.00, 'monthly', '["Até 50.000 contatos", "Recursos avançados", "API completa", "Gerente dedicado"]', '{"contacts": 50000, "emails": 250000, "whatsapp": true}', true)
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const invoicesTable = await queryRunner.getTable("invoices");
        if (invoicesTable) {
            const subFk = invoicesTable.foreignKeys.find(fk => fk.columnNames.indexOf("subscriptionId") !== -1);
            const userFk = invoicesTable.foreignKeys.find(fk => fk.columnNames.indexOf("userId") !== -1);
            if (subFk) await queryRunner.dropForeignKey("invoices", subFk);
            if (userFk) await queryRunner.dropForeignKey("invoices", userFk);
        }

        const subscriptionsTable = await queryRunner.getTable("subscriptions");
        if (subscriptionsTable) {
            const planFk = subscriptionsTable.foreignKeys.find(fk => fk.columnNames.indexOf("planId") !== -1);
            const userFk = subscriptionsTable.foreignKeys.find(fk => fk.columnNames.indexOf("userId") !== -1);
            if (planFk) await queryRunner.dropForeignKey("subscriptions", planFk);
            if (userFk) await queryRunner.dropForeignKey("subscriptions", userFk);
        }

        await queryRunner.dropTable("invoices");
        await queryRunner.dropTable("subscriptions");
        await queryRunner.dropTable("plans");
    }

}
