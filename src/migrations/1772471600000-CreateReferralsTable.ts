import { MigrationInterface, QueryRunner, Table, TableForeignKey } from 'typeorm';

export class CreateReferralsTable1772471600000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.createTable(
            new Table({
                name: 'referrals',
                columns: [
                    {
                        name: 'id',
                        type: 'int',
                        isPrimary: true,
                        isGenerated: true,
                        generationStrategy: 'increment',
                    },
                    {
                        name: 'referrerId',
                        type: 'int',
                    },
                    {
                        name: 'referredId',
                        type: 'int',
                    },
                    {
                        name: 'status',
                        type: 'varchar',
                        length: '20',
                        default: "'pending'",
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

        await queryRunner.createForeignKey(
            'referrals',
            new TableForeignKey({
                name: 'FK_referrals_referrerId',
                columnNames: ['referrerId'],
                referencedColumnNames: ['id'],
                referencedTableName: 'users',
                onDelete: 'CASCADE',
            }),
        );

        await queryRunner.createForeignKey(
            'referrals',
            new TableForeignKey({
                name: 'FK_referrals_referredId',
                columnNames: ['referredId'],
                referencedColumnNames: ['id'],
                referencedTableName: 'users',
                onDelete: 'CASCADE',
            }),
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropTable('referrals');
    }
}
