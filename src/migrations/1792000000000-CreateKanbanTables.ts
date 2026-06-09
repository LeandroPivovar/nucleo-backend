import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class CreateKanbanTables1792000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'kanban_columns',
        columns: [
          { name: 'id', type: 'int', isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
          { name: 'userId', type: 'int', isNullable: false },
          { name: 'name', type: 'varchar', length: '100', isNullable: false },
          { name: 'description', type: 'text', isNullable: true },
          { name: 'order', type: 'int', default: 0, isNullable: false },
          { name: 'active', type: 'boolean', default: true, isNullable: false },
          { name: 'createdAt', type: 'datetime', default: 'CURRENT_TIMESTAMP', isNullable: false },
          { name: 'updatedAt', type: 'datetime', default: 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP', isNullable: false },
        ],
        foreignKeys: [
          { columnNames: ['userId'], referencedTableName: 'users', referencedColumnNames: ['id'], onDelete: 'CASCADE' },
        ],
      }),
      true,
    );

    await queryRunner.createTable(
      new Table({
        name: 'kanban_cards',
        columns: [
          { name: 'id', type: 'int', isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
          { name: 'userId', type: 'int', isNullable: false },
          { name: 'columnId', type: 'int', isNullable: false },
          { name: 'title', type: 'varchar', length: '200', isNullable: false },
          { name: 'description', type: 'text', isNullable: true },
          { name: 'order', type: 'int', default: 0, isNullable: false },
          { name: 'active', type: 'boolean', default: true, isNullable: false },
          { name: 'metadata', type: 'json', isNullable: true },
          { name: 'createdAt', type: 'datetime', default: 'CURRENT_TIMESTAMP', isNullable: false },
          { name: 'updatedAt', type: 'datetime', default: 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP', isNullable: false },
        ],
        foreignKeys: [
          { columnNames: ['userId'], referencedTableName: 'users', referencedColumnNames: ['id'], onDelete: 'CASCADE' },
          { columnNames: ['columnId'], referencedTableName: 'kanban_columns', referencedColumnNames: ['id'], onDelete: 'CASCADE' },
        ],
      }),
      true,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('kanban_cards', true);
    await queryRunner.dropTable('kanban_columns', true);
  }
}
