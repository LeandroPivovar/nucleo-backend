import { MigrationInterface, QueryRunner, Table, TableForeignKey } from "typeorm";

export class CreateTrayConnectionsTable1784000000000 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.createTable(
            new Table({
                name: "tray_connections",
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
                        name: "shopUrl",
                        type: "varchar",
                        length: "255",
                    },
                    {
                        name: "accessToken",
                        type: "text",
                        isNullable: true,
                    },
                    {
                        name: "refreshToken",
                        type: "text",
                        isNullable: true,
                    },
                    {
                        name: "apiUrl",
                        type: "varchar",
                        length: "255",
                        isNullable: true,
                    },
                    {
                        name: "tokenExpiresAt",
                        type: "datetime",
                        isNullable: true,
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
            "tray_connections",
            new TableForeignKey({
                columnNames: ["userId"],
                referencedColumnNames: ["id"],
                referencedTableName: "users",
                onDelete: "CASCADE",
            })
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const table = await queryRunner.getTable("tray_connections");
        if (table) {
            const foreignKey = table.foreignKeys.find(
                (fk) => fk.columnNames.indexOf("userId") !== -1
            );
            if (foreignKey) {
                await queryRunner.dropForeignKey("tray_connections", foreignKey);
            }
        }
        await queryRunner.dropTable("tray_connections");
    }

}
