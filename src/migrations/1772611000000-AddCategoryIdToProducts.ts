import { MigrationInterface, QueryRunner, TableColumn, TableForeignKey } from 'typeorm';

export class AddCategoryIdToProducts1772611000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.addColumn(
            'products',
            new TableColumn({
                name: 'categoryId',
                type: 'int',
                isNullable: true,
            }),
        );

        await queryRunner.createForeignKey(
            'products',
            new TableForeignKey({
                columnNames: ['categoryId'],
                referencedColumnNames: ['id'],
                referencedTableName: 'categories',
                onDelete: 'SET NULL',
            }),
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const table = await queryRunner.getTable('products');
        if (!table) return;

        const foreignKey = table.foreignKeys.find(
            (fk) => fk.columnNames.indexOf('categoryId') !== -1,
        );
        if (foreignKey) {
            await queryRunner.dropForeignKey('products', foreignKey);
        }
        await queryRunner.dropColumn('products', 'categoryId');
    }
}
