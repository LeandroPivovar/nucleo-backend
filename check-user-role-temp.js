require('dotenv').config();
const mysql = require('mysql2/promise');

async function check() {
    try {
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST || '127.0.0.1',
            port: process.env.DB_PORT || 3306,
            user: process.env.DB_USERNAME || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_DATABASE || 'nucleo_crm'
        });

        const [rows] = await connection.execute('SELECT email, role FROM users WHERE email = ?', ['leandrocaetanopivovarr@gmail.com']);
        console.log('User status:', rows[0]);

        await connection.end();
    } catch (err) {
        console.error('Error:', err.message);
    }
}

check();
