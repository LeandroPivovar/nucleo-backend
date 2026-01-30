import { MigrationInterface, QueryRunner, Table, TableForeignKey } from 'typeorm';

export class CreateCampaignsTable1769673917022 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.createTable(
            new Table({
                name: 'campaigns',
                columns: [
                    {
                        name: 'id',
                        type: 'int',
                        isPrimary: true,
                        isGenerated: true,
                        generationStrategy: 'increment',
                    },
                    {
                        name: 'name',
                        type: 'varchar',
                        length: '255',
                    },
                    {
                        name: 'complexity',
                        type: 'varchar',
                        length: '50',
                    },
                    {
                        name: 'channel',
                        type: 'varchar',
                        length: '50',
                    },
                    {
                        name: 'status',
                        type: 'varchar',
                        length: '50',
                        default: "'rascunho'",
                    },
                    {
                        name: 'recipientsCount',
                        type: 'int',
                        default: 0,
                    },
                    {
                        name: 'sentCount',
                        type: 'int',
                        default: 0,
                    },
                    {
                        name: 'opensCount',
                        type: 'int',
                        default: 0,
                    },
                    {
                        name: 'clicksCount',
                        type: 'int',
                        default: 0,
                    },
                    {
                        name: 'revenue',
                        type: 'decimal',
                        precision: 10,
                        scale: 2,
                        default: 0,
                    },
                    {
                        name: 'config',
                        type: 'json',
                        isNullable: true,
                    },
                    {
                        name: 'scheduledAt',
                        type: 'timestamp',
                        isNullable: true,
                    },
                    {
                        name: 'userId',
                        type: 'int',
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
                    },
                ],
            }),
            true,
        );

        await queryRunner.createForeignKey(
            'campaigns',
            new TableForeignKey({
                columnNames: ['userId'],
                referencedColumnNames: ['id'],
                referencedTableName: 'users',
                onDelete: 'CASCADE',
            }),
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const table = await queryRunner.getTable('campaigns');
        if (table) {
            const foreignKey = table.foreignKeys.find(
                (fk) => fk.columnNames.indexOf('userId') !== -1,
            );
            if (foreignKey) {
                await queryRunner.dropForeignKey('campaigns', foreignKey);
            }
            await queryRunner.dropTable('campaigns');
        }
    }
}
