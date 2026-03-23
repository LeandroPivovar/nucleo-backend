import { MigrationInterface, QueryRunner, Table, TableForeignKey } from 'typeorm';

export class CreateCampaignCouponsTable1773250602000
    implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.createTable(
            new Table({
                name: 'campaign_coupons',
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
                        name: 'campaignId',
                        type: 'int',
                    },
                    {
                        name: 'contactId',
                        type: 'int',
                    },
                    {
                        name: 'code',
                        type: 'varchar',
                    },
                    {
                        name: 'platform',
                        type: 'varchar',
                        isNullable: true,
                    },
                    {
                        name: 'value',
                        type: 'decimal',
                        precision: 10,
                        scale: 2,
                        isNullable: true,
                    },
                    {
                        name: 'type',
                        type: 'varchar',
                        isNullable: true,
                    },
                    {
                        name: 'startsAt',
                        type: 'timestamp',
                        isNullable: true,
                    },
                    {
                        name: 'endsAt',
                        type: 'timestamp',
                        isNullable: true,
                    },
                    {
                        name: 'createdAt',
                        type: 'timestamp',
                        default: 'now()',
                    },
                    {
                        name: 'updatedAt',
                        type: 'timestamp',
                        default: 'now()',
                    },
                ],
            }),
            true,
        );

        await queryRunner.createForeignKey(
            'campaign_coupons',
            new TableForeignKey({
                columnNames: ['userId'],
                referencedColumnNames: ['id'],
                referencedTableName: 'users',
                onDelete: 'CASCADE',
            }),
        );

        await queryRunner.createForeignKey(
            'campaign_coupons',
            new TableForeignKey({
                columnNames: ['campaignId'],
                referencedColumnNames: ['id'],
                referencedTableName: 'campaigns',
                onDelete: 'CASCADE',
            }),
        );

        await queryRunner.createForeignKey(
            'campaign_coupons',
            new TableForeignKey({
                columnNames: ['contactId'],
                referencedColumnNames: ['id'],
                referencedTableName: 'contacts',
                onDelete: 'CASCADE',
            }),
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const table = await queryRunner.getTable('campaign_coupons');
        if (table) {
            const foreignKeys = table.foreignKeys;
            for (const fk of foreignKeys) {
                await queryRunner.dropForeignKey('campaign_coupons', fk);
            }
        }
        await queryRunner.dropTable('campaign_coupons');
    }
}
