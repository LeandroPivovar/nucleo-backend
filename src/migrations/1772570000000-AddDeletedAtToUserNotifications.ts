import { MigrationInterface, QueryRunner, TableColumn } from "typeorm";

export class AddDeletedAtToUserNotifications1772570000000 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.addColumn("user_notifications", new TableColumn({
            name: "deletedAt",
            type: "timestamp",
            isNullable: true,
            default: null
        }));
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropColumn("user_notifications", "deletedAt");
    }

}
