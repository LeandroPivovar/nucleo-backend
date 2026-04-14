import { MigrationInterface, QueryRunner, TableColumn } from "typeorm";

export class AddCancellationReasonToSubscriptions1773530000000 implements MigrationInterface {
    name = 'AddCancellationReasonToSubscriptions1773530000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        const table = await queryRunner.getTable('subscriptions');
        if (table && !table.findColumnByName('cancellationReason')) {
            await queryRunner.addColumn('subscriptions', new TableColumn({
                name: "cancellationReason",
                type: "varchar",
                length: "255",
                isNullable: true
            }));
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const table = await queryRunner.getTable('subscriptions');
        if (table && table.findColumnByName('cancellationReason')) {
            await queryRunner.dropColumn('subscriptions', 'cancellationReason');
        }
    }
}
