import { MigrationInterface, QueryRunner, TableColumn } from "typeorm";

export class UpdateEmailConnectionsForDomainVerification1773550000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.addColumns("email_connections", [
            new TableColumn({
                name: "type",
                type: "enum",
                enum: ["smtp", "domain"],
                default: "'smtp'"
            }),
            new TableColumn({
                name: "domain",
                type: "varchar",
                length: "255",
                isNullable: true
            }),
            new TableColumn({
                name: "status",
                type: "enum",
                enum: ["pending", "verified", "rejected"],
                default: "'verified'"
            }),
            new TableColumn({
                name: "dnsTxt",
                type: "text",
                isNullable: true
            }),
            new TableColumn({
                name: "dnsCname",
                type: "text",
                isNullable: true
            }),
            new TableColumn({
                name: "dnsMx",
                type: "text",
                isNullable: true
            }),
            new TableColumn({
                name: "adminNote",
                type: "text",
                isNullable: true
            })
        ]);

        await queryRunner.query(`ALTER TABLE email_connections MODIFY email varchar(255) NULL`);
        await queryRunner.query(`ALTER TABLE email_connections MODIFY smtpHost varchar(255) NULL`);
        await queryRunner.query(`ALTER TABLE email_connections MODIFY smtpPort int NULL`);
        await queryRunner.query(`ALTER TABLE email_connections MODIFY username varchar(255) NULL`);
        await queryRunner.query(`ALTER TABLE email_connections MODIFY password varchar(255) NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropColumn("email_connections", "type");
        await queryRunner.dropColumn("email_connections", "domain");
        await queryRunner.dropColumn("email_connections", "status");
        await queryRunner.dropColumn("email_connections", "dnsTxt");
        await queryRunner.dropColumn("email_connections", "dnsCname");
        await queryRunner.dropColumn("email_connections", "dnsMx");
        await queryRunner.dropColumn("email_connections", "adminNote");

        await queryRunner.query(`ALTER TABLE email_connections MODIFY email varchar(255) NOT NULL`);
        await queryRunner.query(`ALTER TABLE email_connections MODIFY smtpHost varchar(255) NOT NULL`);
        await queryRunner.query(`ALTER TABLE email_connections MODIFY smtpPort int NOT NULL`);
        await queryRunner.query(`ALTER TABLE email_connections MODIFY username varchar(255) NOT NULL`);
        await queryRunner.query(`ALTER TABLE email_connections MODIFY password varchar(255) NOT NULL`);
    }
}
