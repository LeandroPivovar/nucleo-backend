import { createConnection } from 'mysql2/promise';
import { config } from 'dotenv';

config();

async function test() {
    const host = process.env.DB_HOST || 'localhost';
    const port = parseInt(process.env.DB_PORT || '3306');
    const user = process.env.DB_USERNAME || 'root';
    const password = process.env.DB_PASSWORD || '';
    const database = process.env.DB_DATABASE || 'nucleo_crm';

    console.log(`Trying to connect to ${user}@${host}:${port}/${database}...`);

    try {
        const connection = await createConnection({
            host,
            port,
            user,
            password,
            database,
        });
        console.log('✅ Success!');
        await connection.end();
    } catch (err: any) {
        console.error('❌ Failed:', err.message);
        console.error('Error code:', err.code);
    }
}

test();
