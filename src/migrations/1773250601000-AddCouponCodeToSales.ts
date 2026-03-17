import { MigrationInterface, QueryRunner, TableColumn } from "typeorm";

export class AddCouponCodeToSales1773250601000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.addColumn(
            "sales",
            new TableColumn({
                name: "couponCode",
                type: "varchar",
                length: "255",
                isNullable: true,
            })
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropColumn("sales", "couponCode");
    }
}
