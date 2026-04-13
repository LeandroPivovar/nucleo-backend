import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateCampaignMessageEvents1775601000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        const exists = await queryRunner.hasTable('campaign_message_events');
        if (exists) return;

        await queryRunner.createTable(
            new Table({
                name: 'campaign_message_events',
                columns: [
                    {
                        name: 'id',
                        type: 'int',
                        isPrimary: true,
                        isGenerated: true,
                        generationStrategy: 'increment',
                    },
                    {
                        name: 'campaignId',
                        type: 'int',
                    },
                    {
                        name: 'contactId',
                        type: 'int',
                        isNullable: true,
                    },
                    {
                        name: 'messageSid',
                        type: 'varchar',
                        length: '80',
                        isNullable: false,
                    },
                    {
                        name: 'status',
                        type: 'varchar',
                        length: '40',
                        isNullable: false,
                    },
                    {
                        name: 'provider',
                        type: 'varchar',
                        length: '30',
                        default: "'twilio'",
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

        await queryRunner.createIndex('campaign_message_events', new TableIndex({
            name: 'IDX_campaign_message_events_campaignId',
            columnNames: ['campaignId'],
        }));
        await queryRunner.createIndex('campaign_message_events', new TableIndex({
            name: 'IDX_campaign_message_events_contactId',
            columnNames: ['contactId'],
        }));
        await queryRunner.createIndex('campaign_message_events', new TableIndex({
            name: 'UQ_campaign_message_events_messageSid',
            columnNames: ['messageSid'],
            isUnique: true,
        }));
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const exists = await queryRunner.hasTable('campaign_message_events');
        if (!exists) return;
        await queryRunner.dropTable('campaign_message_events');
    }
}
