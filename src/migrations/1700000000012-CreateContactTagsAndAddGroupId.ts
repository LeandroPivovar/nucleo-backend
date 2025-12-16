import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableColumn, TableIndex } from 'typeorm';

export class CreateContactTagsAndAddGroupId1700000000012 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Adicionar groupId na tabela contacts
    await queryRunner.addColumn(
      'contacts',
      new TableColumn({
        name: 'groupId',
        type: 'int',
        isNullable: true,
      }),
    );

    await queryRunner.createForeignKey(
      'contacts',
      new TableForeignKey({
        columnNames: ['groupId'],
        referencedColumnNames: ['id'],
        referencedTableName: 'groups',
        onDelete: 'SET NULL',
      }),
    );

    // Criar tabela contact_tags
    await queryRunner.createTable(
      new Table({
        name: 'contact_tags',
        columns: [
          {
            name: 'id',
            type: 'int',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          {
            name: 'contactId',
            type: 'int',
          },
          {
            name: 'tagId',
            type: 'int',
          },
          {
            name: 'createdAt',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
      true,
    );

    // Criar índices únicos para evitar duplicatas
    await queryRunner.createIndex(
      'contact_tags',
      new TableIndex({
        name: 'IDX_contact_tags_unique',
        columnNames: ['contactId', 'tagId'],
        isUnique: true,
      }),
    );

    // Foreign keys
    await queryRunner.createForeignKey(
      'contact_tags',
      new TableForeignKey({
        columnNames: ['contactId'],
        referencedColumnNames: ['id'],
        referencedTableName: 'contacts',
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'contact_tags',
      new TableForeignKey({
        columnNames: ['tagId'],
        referencedColumnNames: ['id'],
        referencedTableName: 'tags',
        onDelete: 'CASCADE',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('contact_tags');
    await queryRunner.dropColumn('contacts', 'groupId');
  }
}

