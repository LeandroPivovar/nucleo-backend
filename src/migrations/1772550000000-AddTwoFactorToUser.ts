import { MigrationInterface, QueryRunner, TableColumn } from "typeorm";

export class AddTwoFactorToUser1772550000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.addColumn(
            "users",
            new TableColumn({
                name: "twoFactorEnabled",
                type: "boolean",
                default: false,
            })
        );

        await queryRunner.addColumn(
            "users",
            new TableColumn({
                name: "twoFactorCode",
                type: "varchar",
                length: "10",
                isNullable: true,
            })
        );

        await queryRunner.addColumn(
            "users",
            new TableColumn({
                name: "twoFactorExpires",
                type: "datetime",
                isNullable: true,
            })
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropColumn("users", "twoFactorExpires");
        await queryRunner.dropColumn("users", "twoFactorCode");
        await queryRunner.dropColumn("users", "twoFactorEnabled");
    }
}
