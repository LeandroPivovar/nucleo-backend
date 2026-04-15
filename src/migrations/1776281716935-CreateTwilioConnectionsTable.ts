import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateTwilioConnectionsTable1776281716935 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "twilio_connections" (
                "id" SERIAL PRIMARY KEY,
                "userId" integer NOT NULL,
                "friendlyName" varchar(255),
                "whatsappFrom" varchar(255) NOT NULL,
                "accountSid" varchar(255),
                "authToken" text,
                "status" varchar(50) NOT NULL DEFAULT 'pending',
                "adminNote" text,
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "FK_twilio_connections_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
            )
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "twilio_connections"`);
    }

}
