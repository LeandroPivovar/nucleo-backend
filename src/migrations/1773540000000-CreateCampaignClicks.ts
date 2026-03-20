import { MigrationInterface, QueryRunner, Table, TableForeignKey } from "typeorm";

export class CreateCampaignClicks1773540000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.createTable(
            new Table({
                name: "campaign_clicks",
                columns: [
                    {
                        name: "id",
                        type: "int",
                        isPrimary: true,
                        isGenerated: true,
                        generationStrategy: "increment",
                    },
                    {
                        name: "campaignId",
                        type: "int",
                    },
                    {
                        name: "contactId",
                        type: "int",
                    },
                    {
                        name: "createdAt",
                        type: "timestamp",
                        default: "now()",
                    },
                ],
            }),
            true
        );

        await queryRunner.createForeignKey(
            "campaign_clicks",
            new TableForeignKey({
                columnNames: ["campaignId"],
                referencedColumnNames: ["id"],
                referencedTableName: "campaigns",
                onDelete: "CASCADE",
            })
        );

        await queryRunner.createForeignKey(
            "campaign_clicks",
            new TableForeignKey({
                columnNames: ["contactId"],
                referencedColumnNames: ["id"],
                referencedTableName: "contacts",
                onDelete: "CASCADE",
            })
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropTable("campaign_clicks");
    }
}
