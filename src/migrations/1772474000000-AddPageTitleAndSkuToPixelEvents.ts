import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPageTitleAndSkuToPixelEvents1772474000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
      ALTER TABLE pixel_events 
      ADD COLUMN pageTitle TEXT NULL,
      ADD COLUMN sku VARCHAR(100) NULL
    `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
      ALTER TABLE pixel_events 
      DROP COLUMN pageTitle,
      DROP COLUMN sku
    `);
    }
}
