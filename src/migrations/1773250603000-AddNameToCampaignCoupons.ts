import { MigrationInterface, QueryRunner, TableColumn } from "typeorm";

export class AddNameToCampaignCoupons1773250603000 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.addColumn(
            "campaign_coupons",
            new TableColumn({
                name: "name",
                type: "varchar",
                length: "255",
                isNullable: true
            })
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropColumn("campaign_coupons", "name");
    }

}
