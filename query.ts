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
    const [rows] = await connection.execute('SELECT id, name, gender, status FROM contact LIMIT 10');
    console.log('Sample Contacts:', rows);

    const [distinctRows] = await connection.execute('SELECT DISTINCT gender FROM contact');
    console.log('Distinct Genders:', distinctRows);
    process.exit(0);
}
run();
