import { createConnection } from 'mysql2/promise';
import * as dotenv from 'dotenv';
dotenv.config();

async function run() {
    const connection = await createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USERNAME,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_DATABASE,
    });
    const [rows] = await connection.execute('SELECT `key`, `value` FROM system_settings WHERE `key` LIKE "%PKG%" OR `key` LIKE "UNIT_PRICE_%"');
    console.log('Settings:', rows);
    process.exit(0);
}
run();
