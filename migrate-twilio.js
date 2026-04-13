const mysql2 = require('mysql2/promise');

async function run() {
    const conn = await mysql2.createConnection({
        host: 'localhost',
        user: 'root',
        password: '',
        database: 'nucleo_crm'
    });

    const sqls = [
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS twilioAccountSid VARCHAR(50) NULL DEFAULT NULL",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS twilioAuthToken VARCHAR(255) NULL DEFAULT NULL",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS twilioWhatsappFrom VARCHAR(30) NULL DEFAULT NULL"
    ];

    for (const sql of sqls) {
        try {
            await conn.execute(sql);
            console.log('OK:', sql.substring(0, 70));
        } catch (e) {
            console.log('SKIP/ERROR:', e.message);
        }
    }

    const [rows] = await conn.query(
        "SELECT COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='nucleo_crm' AND TABLE_NAME='users' AND COLUMN_NAME LIKE 'twilio%'"
    );
    console.log('\nColunas Twilio adicionadas à tabela users:');
    console.table(rows);

    await conn.end();
}

run().catch(console.error);
