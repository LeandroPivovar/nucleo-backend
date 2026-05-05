import { MigrationInterface, QueryRunner } from "typeorm";

export class SetDefaultPackages1777946599102 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        const settings = [
            // WhatsApp
            { key: 'WHATSAPP_PKG1_AMOUNT', value: '60' }, { key: 'WHATSAPP_PKG1_PRICE', value: '33' },
            { key: 'WHATSAPP_PKG2_AMOUNT', value: '100' }, { key: 'WHATSAPP_PKG2_PRICE', value: '55' },
            { key: 'WHATSAPP_PKG3_AMOUNT', value: '500' }, { key: 'WHATSAPP_PKG3_PRICE', value: '275' },
            { key: 'WHATSAPP_PKG4_AMOUNT', value: '1000' }, { key: 'WHATSAPP_PKG4_PRICE', value: '550' },
            
            // SMS
            { key: 'SMS_PKG1_AMOUNT', value: '60' }, { key: 'SMS_PKG1_PRICE', value: '18' },
            { key: 'SMS_PKG2_AMOUNT', value: '100' }, { key: 'SMS_PKG2_PRICE', value: '30' },
            { key: 'SMS_PKG3_AMOUNT', value: '500' }, { key: 'SMS_PKG3_PRICE', value: '150' },
            { key: 'SMS_PKG4_AMOUNT', value: '1000' }, { key: 'SMS_PKG4_PRICE', value: '300' },
            
            // Email
            { key: 'EMAIL_PKG1_AMOUNT', value: '60' }, { key: 'EMAIL_PKG1_PRICE', value: '0.60' },
            { key: 'EMAIL_PKG2_AMOUNT', value: '100' }, { key: 'EMAIL_PKG2_PRICE', value: '1' },
            { key: 'EMAIL_PKG3_AMOUNT', value: '500' }, { key: 'EMAIL_PKG3_PRICE', value: '5' },
            { key: 'EMAIL_PKG4_AMOUNT', value: '1000' }, { key: 'EMAIL_PKG4_PRICE', value: '10' }
        ];

        for (const s of settings) {
            await queryRunner.query(
                `INSERT INTO system_settings (\`key\`, \`value\`, \`description\`) 
                 VALUES (?, ?, ?) 
                 ON DUPLICATE KEY UPDATE \`value\` = ?`,
                [s.key, s.value, 'Configuração de Pacote', s.value]
            );
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // No need to revert
    }
}
