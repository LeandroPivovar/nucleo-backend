import { MigrationInterface, QueryRunner, Table, TableIndex } from "typeorm";

export class CreateInternalAnalyticsTable1773560000000 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.createTable(new Table({
            name: "internal_analytics",
            columns: [
                {
                    name: "id",
                    type: "int",
                    isPrimary: true,
                    isGenerated: true,
                    generationStrategy: "increment"
                },
                {
                    name: "userId",
                    type: "int",
                    isNullable: true
                },
                {
                    name: "type",
                    type: "varchar",
                    length: "50"
                },
                {
                    name: "name",
                    type: "varchar",
                    length: "100"
                },
                {
                    name: "metadata",
                    type: "json",
                    isNullable: true
                },
                {
                    name: "timestamp",
                    type: "timestamp",
                    default: "CURRENT_TIMESTAMP"
                }
            ]
        }), true);

        // Indexes
        await queryRunner.createIndex("internal_analytics", new TableIndex({
            name: "IDX_INTERNAL_ANALYTICS_USER_ID",
            columnNames: ["userId"]
        }));

        await queryRunner.createIndex("internal_analytics", new TableIndex({
            name: "IDX_INTERNAL_ANALYTICS_TYPE",
            columnNames: ["type"]
        }));

        await queryRunner.createIndex("internal_analytics", new TableIndex({
            name: "IDX_INTERNAL_ANALYTICS_NAME",
            columnNames: ["name"]
        }));

        await queryRunner.createIndex("internal_analytics", new TableIndex({
            name: "IDX_INTERNAL_ANALYTICS_TIMESTAMP",
            columnNames: ["timestamp"]
        }));
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropTable("internal_analytics");
    }

}
