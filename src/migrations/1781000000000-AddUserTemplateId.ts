import { MigrationInterface, QueryRunner, TableColumn, TableIndex } from "typeorm";

export class AddUserTemplateId1781000000000 implements MigrationInterface {
    name = 'AddUserTemplateId1781000000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // 1. Add the column as nullable first
        await queryRunner.addColumn('users', new TableColumn({
            name: 'templateId',
            type: 'varchar',
            length: '4',
            isNullable: true
        }));

        // 2. Generate unique IDs for all existing users
        const users = await queryRunner.query('SELECT id FROM users');
        const usedIds = new Set<string>();

        for (const user of users) {
            let templateId = '';
            let isUnique = false;
            while (!isUnique) {
                templateId = this.generateId();
                if (!usedIds.has(templateId)) {
                    isUnique = true;
                }
            }
            usedIds.add(templateId);
            await queryRunner.query('UPDATE users SET templateId = ? WHERE id = ?', [templateId, user.id]);
        }

        // 3. Add the unique index
        await queryRunner.createIndex('users', new TableIndex({
            name: 'IDX_USERS_TEMPLATE_ID',
            columnNames: ['templateId'],
            isUnique: true
        }));
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropIndex('users', 'IDX_USERS_TEMPLATE_ID');
        await queryRunner.dropColumn('users', 'templateId');
    }

    private generateId(): string {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let result = '';
        for (let i = 0; i < 4; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }
}
