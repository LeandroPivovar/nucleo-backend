import { MigrationInterface, QueryRunner, Table, TableForeignKey } from "typeorm";

export class AddReferralPercentageAndCommissions1772472000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        // 1. Adicionar coluna referralPercentage à tabela users
        await queryRunner.query(`
            ALTER TABLE users 
            ADD COLUMN IF NOT EXISTS \`referralPercentage\` DECIMAL(5,2) DEFAULT 3.00
        `);

        // 2. Criar tabela referral_commissions
        await queryRunner.createTable(
            new Table({
                name: "referral_commissions",
                columns: [
                    {
                        name: "id",
                        type: "int",
                        isPrimary: true,
                        isGenerated: true,
                        generationStrategy: "increment",
                    },
                    {
                        name: "referrerId",
                        type: "int",
                    },
                    {
                        name: "referredId",
                        type: "int",
                    },
                    {
                        name: "subscriptionId",
                        type: "int",
                        isNullable: true,
                    },
                    {
                        name: "amount",
                        type: "decimal",
                        precision: 10,
                        scale: 2,
                    },
                    {
                        name: "percentage",
                        type: "decimal",
                        precision: 5,
                        scale: 2,
                    },
                    {
                        name: "createdAt",
                        type: "timestamp",
                        default: "CURRENT_TIMESTAMP",
                    },
                ],
            }),
            true
        );

        // 3. Adicionar chaves estrangeiras
        await queryRunner.createForeignKey(
            "referral_commissions",
            new TableForeignKey({
                columnNames: ["referrerId"],
                referencedColumnNames: ["id"],
                referencedTableName: "users",
                onDelete: "CASCADE",
            })
        );

        await queryRunner.createForeignKey(
            "referral_commissions",
            new TableForeignKey({
                columnNames: ["referredId"],
                referencedColumnNames: ["id"],
                referencedTableName: "users",
                onDelete: "CASCADE",
            })
        );

        await queryRunner.createForeignKey(
            "referral_commissions",
            new TableForeignKey({
                columnNames: ["subscriptionId"],
                referencedColumnNames: ["id"],
                referencedTableName: "subscriptions",
                onDelete: "SET NULL",
            })
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropTable("referral_commissions");
        await queryRunner.query(`ALTER TABLE users DROP COLUMN \`referralPercentage\``);
    }
}
