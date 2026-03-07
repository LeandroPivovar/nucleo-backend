import { MigrationInterface, QueryRunner } from "typeorm";

export class UpdatePlanLimits1772605000000 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Plano 1: Basic -> 5.000 contatos
        await queryRunner.query(`
            UPDATE plans 
            SET limits = JSON_SET(limits, '$.contacts', 5000)
            WHERE id = 1
        `);

        // Plano 2: Pro -> 10.000 contatos (ja esta correto, mas garantindo)
        await queryRunner.query(`
            UPDATE plans 
            SET limits = JSON_SET(limits, '$.contacts', 10000)
            WHERE id = 2
        `);

        // Plano 3: Enterprise -> 35.000 contatos
        await queryRunner.query(`
            UPDATE plans 
            SET limits = JSON_SET(limits, '$.contacts', 35000)
            WHERE id = 3
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Reverter para os limites anteriores
        await queryRunner.query(`
            UPDATE plans 
            SET limits = JSON_SET(limits, '$.contacts', 2000)
            WHERE id = 1
        `);

        await queryRunner.query(`
            UPDATE plans 
            SET limits = JSON_SET(limits, '$.contacts', 10000)
            WHERE id = 2
        `);

        await queryRunner.query(`
            UPDATE plans 
            SET limits = JSON_SET(limits, '$.contacts', 50000)
            WHERE id = 3
        `);
    }

}
