import { MigrationInterface, QueryRunner, Table, TableForeignKey } from "typeorm";

export class CreateNotificationsTables1772560000000 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Create Notifications Table
        await queryRunner.createTable(new Table({
            name: "notifications",
            columns: [
                { name: "id", type: "int", isPrimary: true, isGenerated: true, generationStrategy: "increment" },
                { name: "title", type: "varchar", length: "255" },
                { name: "message", type: "text" },
                { name: "type", type: "enum", enum: ["system", "info", "success", "warning", "error"], default: "'system'" },
                { name: "link", type: "varchar", length: "255", isNullable: true },
                { name: "userId", type: "int", isNullable: true },
                { name: "createdAt", type: "timestamp", default: "CURRENT_TIMESTAMP" }
            ]
        }), true);

        // Create User Notifications Table (Read status)
        await queryRunner.createTable(new Table({
            name: "user_notifications",
            columns: [
                { name: "userId", type: "int", isPrimary: true },
                { name: "notificationId", type: "int", isPrimary: true },
                { name: "readAt", type: "timestamp", isNullable: true },
                { name: "createdAt", type: "timestamp", default: "CURRENT_TIMESTAMP" }
            ]
        }), true);

        // Foreign Keys for Notifications
        await queryRunner.createForeignKey("notifications", new TableForeignKey({
            columnNames: ["userId"],
            referencedColumnNames: ["id"],
            referencedTableName: "users",
            onDelete: "CASCADE"
        }));

        // Foreign Keys for User Notifications
        await queryRunner.createForeignKey("user_notifications", new TableForeignKey({
            columnNames: ["userId"],
            referencedColumnNames: ["id"],
            referencedTableName: "users",
            onDelete: "CASCADE"
        }));

        await queryRunner.createForeignKey("user_notifications", new TableForeignKey({
            columnNames: ["notificationId"],
            referencedColumnNames: ["id"],
            referencedTableName: "notifications",
            onDelete: "CASCADE"
        }));
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const userNotificationsTable = await queryRunner.getTable("user_notifications");
        if (userNotificationsTable) {
            const userFk = userNotificationsTable.foreignKeys.find(fk => fk.columnNames.indexOf("userId") !== -1);
            const notifFk = userNotificationsTable.foreignKeys.find(fk => fk.columnNames.indexOf("notificationId") !== -1);
            if (userFk) await queryRunner.dropForeignKey("user_notifications", userFk);
            if (notifFk) await queryRunner.dropForeignKey("user_notifications", notifFk);
        }

        const notificationsTable = await queryRunner.getTable("notifications");
        if (notificationsTable) {
            const userFk = notificationsTable.foreignKeys.find(fk => fk.columnNames.indexOf("userId") !== -1);
            if (userFk) await queryRunner.dropForeignKey("notifications", userFk);
        }

        await queryRunner.dropTable("user_notifications");
        await queryRunner.dropTable("notifications");
    }

}
