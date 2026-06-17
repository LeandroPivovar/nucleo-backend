import { MigrationInterface, QueryRunner, TableColumn, TableForeignKey } from 'typeorm';

export class AddKanbanPipelineFields1793000000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        // kanban_columns: campos de pipeline
        await queryRunner.addColumns('kanban_columns', [
            new TableColumn({
                name: 'is_origin',
                type: 'boolean',
                default: false,
                comment: 'Indica se é a coluna de origem (entrada de leads)',
            }),
            new TableColumn({
                name: 'entry_type',
                type: 'varchar',
                length: '50',
                isNullable: true,
                comment: 'capture_page | form | product_purchase | ecommerce_event | manual',
            }),
            new TableColumn({
                name: 'entry_config',
                type: 'json',
                isNullable: true,
                comment: 'Configuração da entrada: { productId, formId, pageUrl, eventType, ... }',
            }),
            new TableColumn({
                name: 'campaign_id',
                type: 'int',
                isNullable: true,
                comment: 'Campanha disparada ao mover um lead para esta coluna',
            }),
            new TableColumn({
                name: 'conditions',
                type: 'json',
                isNullable: true,
                comment: 'Condições para disparar a campanha: [{ type, value }]',
            }),
        ]);

        // FK campaign_id → campaigns
        await queryRunner.createForeignKey('kanban_columns', new TableForeignKey({
            columnNames: ['campaign_id'],
            referencedTableName: 'campaigns',
            referencedColumnNames: ['id'],
            onDelete: 'SET NULL',
        }));

        // kanban_cards: vínculo com contato
        await queryRunner.addColumn('kanban_cards', new TableColumn({
            name: 'contact_id',
            type: 'int',
            isNullable: true,
            comment: 'Contato vinculado a este card',
        }));

        await queryRunner.createForeignKey('kanban_cards', new TableForeignKey({
            columnNames: ['contact_id'],
            referencedTableName: 'contacts',
            referencedColumnNames: ['id'],
            onDelete: 'SET NULL',
        }));
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const cardsTable = await queryRunner.getTable('kanban_cards');
        const cardsFk = cardsTable?.foreignKeys.find(fk => fk.columnNames.includes('contact_id'));
        if (cardsFk) await queryRunner.dropForeignKey('kanban_cards', cardsFk);
        await queryRunner.dropColumn('kanban_cards', 'contact_id');

        const columnsTable = await queryRunner.getTable('kanban_columns');
        const campaignFk = columnsTable?.foreignKeys.find(fk => fk.columnNames.includes('campaign_id'));
        if (campaignFk) await queryRunner.dropForeignKey('kanban_columns', campaignFk);

        await queryRunner.dropColumns('kanban_columns', ['is_origin', 'entry_type', 'entry_config', 'campaign_id', 'conditions']);
    }
}
