import { MigrationInterface, QueryRunner, Table, TableIndex, TableForeignKey } from "typeorm";

export class CreateLoginAttempts1772590000000 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.createTable(new Table({
            name: "login_attempts",
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
                    name: "email",
                    type: "varchar",
                    length: "255"
                },
                {
                    name: "ip",
                    type: "varchar",
                    length: "45"
                },
                {
                    name: "city",
                    type: "varchar",
                    length: "100",
                    isNullable: true
                },
                {
                    name: "country",
                    type: "varchar",
                    length: "100",
                    isNullable: true
                },
                {
                    name: "success",
                    type: "boolean"
                },
                {
                    name: "twoFactorUsed",
                    type: "boolean",
                    default: false
                },
                {
                    name: "createdAt",
                    type: "timestamp",
                    default: "CURRENT_TIMESTAMP"
                }
            ]
        }), true);

        await queryRunner.createForeignKey("login_attempts", new TableForeignKey({
            columnNames: ["userId"],
            referencedColumnNames: ["id"],
            referencedTableName: "users",
            onDelete: "SET NULL"
        }));

        await queryRunner.createIndex("login_attempts", new TableIndex({
            name: "IDX_LOGIN_ATTEMPTS_USER_ID",
            columnNames: ["userId"]
        }));

        await queryRunner.createIndex("login_attempts", new TableIndex({
            name: "IDX_LOGIN_ATTEMPTS_EMAIL",
            columnNames: ["email"]
        }));
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropTable("login_attempts");
    }

}
