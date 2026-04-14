import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddPageTitleAndSkuToPixelEvents1772474000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        const table = await queryRunner.getTable('pixel_events');
        if (!table) return;

        if (!table.findColumnByName('pageTitle')) {
            await queryRunner.addColumn('pixel_events', new TableColumn({
                name: 'pageTitle',
                type: 'text',
                isNullable: true,
            }));
        }

        if (!table.findColumnByName('sku')) {
            await queryRunner.addColumn('pixel_events', new TableColumn({
                name: 'sku',
                type: 'varchar',
                length: '100',
                isNullable: true,
            }));
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const table = await queryRunner.getTable('pixel_events');
        if (!table) return;

        if (table.findColumnByName('pageTitle')) {
            await queryRunner.dropColumn('pixel_events', 'pageTitle');
        }

        if (table.findColumnByName('sku')) {
            await queryRunner.dropColumn('pixel_events', 'sku');
        }
    }
}
