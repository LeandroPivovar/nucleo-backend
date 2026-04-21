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

        const [tables] = await connection.execute("SHOW TABLES LIKE 'admin_campaign_templates'");
        if (tables.length > 0) {
            console.log('TABLE_EXISTS');
        } else {
            console.log('TABLE_MISSING');
        }

        await connection.end();
    } catch (err) {
        console.error('Error:', err.message);
    }
}

check();
