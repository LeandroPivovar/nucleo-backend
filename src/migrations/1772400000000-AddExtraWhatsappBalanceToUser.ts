import { MigrationInterface, QueryRunner, TableColumn } from "typeorm";

export class AddExtraWhatsappBalanceToUser1772400000000 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        const table = await queryRunner.getTable('users');
        if (table && !table.findColumnByName('extraWhatsappBalance')) {
            await queryRunner.addColumn('users', new TableColumn({
                name: "extraWhatsappBalance",
                type: "int",
                isNullable: false,
                default: 0
            }));
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const table = await queryRunner.getTable('users');
        if (table && table.findColumnByName('extraWhatsappBalance')) {
            await queryRunner.dropColumn('users', 'extraWhatsappBalance');
        }
    }

}
