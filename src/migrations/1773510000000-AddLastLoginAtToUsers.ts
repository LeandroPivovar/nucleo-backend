import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddLastLoginAtToUsers1773510000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.addColumn(
            'users',
            new TableColumn({
                name: 'lastLoginAt',
                type: 'datetime',
                isNullable: true,
            }),
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropColumn('users', 'lastLoginAt');
    }
}
