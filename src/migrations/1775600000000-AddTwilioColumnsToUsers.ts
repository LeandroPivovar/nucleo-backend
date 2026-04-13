import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddTwilioColumnsToUsers1775600000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        const table = await queryRunner.getTable('users');
        if (!table) return;

        const columnsToAdd: TableColumn[] = [];

        if (!table.findColumnByName('twilioAccountSid')) {
            columnsToAdd.push(
                new TableColumn({
                    name: 'twilioAccountSid',
                    type: 'varchar',
                    length: '50',
                    isNullable: true,
                }),
            );
        }

        if (!table.findColumnByName('twilioAuthToken')) {
            columnsToAdd.push(
                new TableColumn({
                    name: 'twilioAuthToken',
                    type: 'varchar',
                    length: '255',
                    isNullable: true,
                }),
            );
        }

        if (!table.findColumnByName('twilioWhatsappFrom')) {
            columnsToAdd.push(
                new TableColumn({
                    name: 'twilioWhatsappFrom',
                    type: 'varchar',
                    length: '30',
                    isNullable: true,
                }),
            );
        }

        if (columnsToAdd.length > 0) {
            await queryRunner.addColumns('users', columnsToAdd);
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const table = await queryRunner.getTable('users');
        if (!table) return;

        const removable = ['twilioWhatsappFrom', 'twilioAuthToken', 'twilioAccountSid']
            .filter((column) => table.findColumnByName(column));

        for (const column of removable) {
            await queryRunner.dropColumn('users', column);
        }
    }
}
