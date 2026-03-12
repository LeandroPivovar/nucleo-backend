import { MigrationInterface, QueryRunner, TableColumn } from "typeorm";

export class AddExternalIdToSales1773250600000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.addColumn(
            "sales",
            new TableColumn({
                name: "externalId",
                type: "varchar",
                length: "255",
                isNullable: true,
            })
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropColumn("sales", "externalId");
    }
}
