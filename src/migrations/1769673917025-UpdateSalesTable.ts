import { MigrationInterface, QueryRunner, TableColumn, TableForeignKey } from "typeorm";

export class UpdateSalesTable1769673917025 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.addColumns("sales", [
            new TableColumn({
                name: "paymentMethod",
                type: "varchar",
                length: "50",
                isNullable: true
            }),
            new TableColumn({
                name: "campaignId",
                type: "int",
                isNullable: true
            }),
            new TableColumn({
                name: "channel",
                type: "varchar",
                length: "50",
                isNullable: true
            }),
            new TableColumn({
                name: "contactId",
                type: "int",
                isNullable: true
            })
        ]);

        await queryRunner.createForeignKey("sales", new TableForeignKey({
            columnNames: ["campaignId"],
            referencedColumnNames: ["id"],
            referencedTableName: "campaigns",
            onDelete: "SET NULL"
        }));

        await queryRunner.createForeignKey("sales", new TableForeignKey({
            columnNames: ["contactId"],
            referencedColumnNames: ["id"],
            referencedTableName: "contacts",
            onDelete: "SET NULL"
        }));
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const table = await queryRunner.getTable("sales");
        if (!table) return;
        const campaignForeignKey = table.foreignKeys.find(fk => fk.columnNames.indexOf("campaignId") !== -1);
        const contactForeignKey = table.foreignKeys.find(fk => fk.columnNames.indexOf("contactId") !== -1);

        if (campaignForeignKey) {
            await queryRunner.dropForeignKey("sales", campaignForeignKey);
        }

        if (contactForeignKey) {
            await queryRunner.dropForeignKey("sales", contactForeignKey);
        }

        await queryRunner.dropColumns("sales", ["paymentMethod", "campaignId", "channel", "contactId"]);
    }

}
