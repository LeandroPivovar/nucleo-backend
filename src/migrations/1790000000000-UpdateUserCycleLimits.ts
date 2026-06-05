import { MigrationInterface, QueryRunner, TableColumn } from "typeorm";

export class UpdateUserCycleLimits1790000000000 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        const table = await queryRunner.getTable('users');
        
        if (table && table.findColumnByName('emailsSentMonth')) {
            await queryRunner.dropColumn('users', 'emailsSentMonth');
        }

        if (table && !table.findColumnByName('cycleEmailsSent')) {
            await queryRunner.addColumns('users', [
                new TableColumn({
                    name: "cycleEmailsSent",
                    type: "int",
                    default: 0,
                }),
                new TableColumn({
                    name: "cycleSmsSent",
                    type: "int",
                    default: 0,
                }),
                new TableColumn({
                    name: "cycleWhatsappSent",
                    type: "int",
                    default: 0,
                }),
                new TableColumn({
                    name: "cycleCampaignsCreated",
                    type: "int",
                    default: 0,
                })
            ]);
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const table = await queryRunner.getTable('users');

        if (table && table.findColumnByName('cycleEmailsSent')) {
            await queryRunner.dropColumns('users', [
                'cycleEmailsSent',
                'cycleSmsSent',
                'cycleWhatsappSent',
                'cycleCampaignsCreated'
            ]);
        }

        if (table && !table.findColumnByName('emailsSentMonth')) {
            await queryRunner.addColumn('users', new TableColumn({
                name: "emailsSentMonth",
                type: "int",
                default: 0,
            }));
        }
    }
}
