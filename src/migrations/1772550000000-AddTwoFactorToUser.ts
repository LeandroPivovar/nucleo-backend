import { MigrationInterface, QueryRunner, TableColumn } from "typeorm";

export class AddTwoFactorToUser1772550000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        // Usando consultas puras para evitar problemas de metadados durante a migration
        await queryRunner.query("ALTER TABLE `users` ADD COLUMN `twoFactorEnabled` tinyint NOT NULL DEFAULT 0");
        await queryRunner.query("ALTER TABLE `users` ADD COLUMN `twoFactorCode` varchar(10) NULL");
        await queryRunner.query("ALTER TABLE `users` ADD COLUMN `twoFactorExpires` datetime NULL");
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query("ALTER TABLE `users` DROP COLUMN `twoFactorEnabled`");
        await queryRunner.query("ALTER TABLE `users` DROP COLUMN `twoFactorCode`");
        await queryRunner.query("ALTER TABLE `users` DROP COLUMN `twoFactorExpires`");
    }
}
