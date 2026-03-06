import { createConnection } from 'mysql2/promise';
import { config } from 'dotenv';

config();

async function run() {
    const host = process.env.DB_HOST || 'localhost';
    const port = parseInt(process.env.DB_PORT || '3306');
    const user = process.env.DB_USERNAME || 'root';
    const password = process.env.DB_PASSWORD || '';
    const database = process.env.DB_DATABASE || 'nucleo_crm';

    console.log(`Connecting to ${database}...`);

    try {
        const connection = await createConnection({
            host,
            port,
            user,
            password,
            database,
        });

        console.log('Adding 2FA columns...');

        // Add columns one by one in case some already exist
        const columns = [
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS twoFactorEnabled BOOLEAN DEFAULT FALSE",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS twoFactorCode VARCHAR(10) NULL",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS twoFactorExpires DATETIME NULL"
        ];

        for (const sql of columns) {
            try {
                await connection.query(sql);
                console.log(`Executed: ${sql}`);
            } catch (err: any) {
                if (err.code === 'ER_DUP_COLUMN_NAME' || err.message.includes('Duplicate column')) {
                    console.log(`Column already exists, skipping...`);
                } else {
                    throw err;
                }
            }
        }

        console.log('✅ Success!');
        await connection.end();
        process.exit(0);
    } catch (err: any) {
        console.error('❌ Failed:', err.message);
        process.exit(1);
    }
}

run();
