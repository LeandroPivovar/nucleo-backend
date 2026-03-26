import { MigrationInterface, QueryRunner, Table, TableForeignKey } from "typeorm";

export class CreateLojaIntegradaConnectionsTable1773570000000 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.createTable(
            new Table({
                name: "loja_integrada_connections",
                columns: [
                    {
                        name: "id",
                        type: "int",
                        isPrimary: true,
                        isGenerated: true,
                        generationStrategy: "increment",
                    },
                    {
                        name: "userId",
                        type: "int",
                    },
                    {
                        name: "storeName",
                        type: "varchar",
                        length: "255",
                    },
                    {
                        name: "apiKey",
                        type: "text",
                    },
                    {
                        name: "applicationKey",
                        type: "text",
                    },
                    {
                        name: "isActive",
                        type: "boolean",
                        default: true,
                    },
                    {
                        name: "lastSyncAt",
                        type: "datetime",
                        isNullable: true,
                    },
                    {
                        name: "createdAt",
                        type: "datetime",
                        default: "CURRENT_TIMESTAMP",
                    },
                    {
                        name: "updatedAt",
                        type: "datetime",
                        default: "CURRENT_TIMESTAMP",
                        onUpdate: "CURRENT_TIMESTAMP",
                    },
                ],
            }),
            true
        );

        await queryRunner.createForeignKey(
            "loja_integrada_connections",
            new TableForeignKey({
                columnNames: ["userId"],
                referencedColumnNames: ["id"],
                referencedTableName: "users",
                onDelete: "CASCADE",
            })
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const table = await queryRunner.getTable("loja_integrada_connections");
        const foreignKey = table.foreignKeys.find(
            (fk) => fk.columnNames.indexOf("userId") !== -1
        );
        await queryRunner.dropForeignKey("loja_integrada_connections", foreignKey);
        await queryRunner.dropTable("loja_integrada_connections");
    }

}
