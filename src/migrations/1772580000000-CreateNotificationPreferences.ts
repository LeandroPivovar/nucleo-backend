import { MigrationInterface, QueryRunner, Table, TableUnique } from "typeorm";

export class CreateNotificationPreferences1772580000000 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.createTable(new Table({
            name: "notification_preferences",
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
                    type: "int"
                },
                {
                    name: "type",
                    type: "varchar"
                },
                {
                    name: "enabled",
                    type: "boolean",
                    default: true
                }
            ],
            indices: [
                {
                    name: "UQ_USER_NOTIFICATION_PREFERENCE",
                    columnNames: ["userId", "type"],
                    isUnique: true
                }
            ]
        }), true);

        // Not strictly necessary to ALTER enum if we use varchar column for enum in some DBs, 
        // but for MySQL/Postgres we might need to handle it.
        // Assuming MySQL based on previous migrations using type: "enum"
        // In MySQL, we can just alter column.
        await queryRunner.query(`ALTER TABLE notifications MODIFY COLUMN type ENUM('system', 'info', 'success', 'warning', 'error', 'campaign', 'billing', 'security', 'marketing') DEFAULT 'system'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropTable("notification_preferences");
        await queryRunner.query(`ALTER TABLE notifications MODIFY COLUMN type ENUM('system', 'info', 'success', 'warning', 'error') DEFAULT 'system'`);
    }

}
