import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex } from 'typeorm';

export class CreateContactSegmentationsTable1700000000013 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Criar tabela contact_segmentations
    await queryRunner.createTable(
      new Table({
        name: 'contact_segmentations',
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
            name: 'segmentationId',
            type: 'varchar',
            length: '100',
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
      'contact_segmentations',
      new TableIndex({
        name: 'IDX_contact_segmentations_unique',
        columnNames: ['contactId', 'segmentationId'],
        isUnique: true,
      }),
    );

    // Foreign key
    await queryRunner.createForeignKey(
      'contact_segmentations',
      new TableForeignKey({
        columnNames: ['contactId'],
        referencedColumnNames: ['id'],
        referencedTableName: 'contacts',
        onDelete: 'CASCADE',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('contact_segmentations');
  }
}

