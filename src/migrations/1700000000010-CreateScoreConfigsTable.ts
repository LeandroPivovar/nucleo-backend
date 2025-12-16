import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex } from 'typeorm';

export class CreateScoreConfigsTable1700000000010 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'score_configs',
        columns: [
          {
            name: 'id',
            type: 'int',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          {
            name: 'userId',
            type: 'int',
          },
          {
            name: 'emailOpens',
            type: 'decimal',
            precision: 10,
            scale: 2,
            default: 2,
          },
          {
            name: 'linkClicks',
            type: 'decimal',
            precision: 10,
            scale: 2,
            default: 3,
          },
          {
            name: 'purchases',
            type: 'decimal',
            precision: 10,
            scale: 2,
            default: 10,
          },
          {
            name: 'ltvDivisor',
            type: 'decimal',
            precision: 10,
            scale: 2,
            default: 10,
          },
          {
            name: 'createdAt',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updatedAt',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
            onUpdate: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'score_configs',
      new TableIndex({
        name: 'IDX_score_configs_userId',
        columnNames: ['userId'],
        isUnique: true,
      }),
    );

    await queryRunner.createForeignKey(
      'score_configs',
      new TableForeignKey({
        name: 'FK_score_configs_userId',
        columnNames: ['userId'],
        referencedColumnNames: ['id'],
        referencedTableName: 'users',
        onDelete: 'CASCADE',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('score_configs');
  }
}

