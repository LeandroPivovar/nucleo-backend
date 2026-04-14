import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddPostalCodeToUsers1772600000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        const table = await queryRunner.getTable('users');
        if (table && !table.findColumnByName('postalCode')) {
            await queryRunner.addColumn('users', new TableColumn({
                name: "postalCode",
                type: "varchar",
                length: "20",
                isNullable: true
            }));
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const table = await queryRunner.getTable('users');
        if (table && table.findColumnByName('postalCode')) {
            await queryRunner.dropColumn('users', 'postalCode');
        }
    }
}
