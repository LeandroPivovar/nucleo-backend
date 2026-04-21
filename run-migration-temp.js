require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

async function run() {
    try {
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST || '127.0.0.1',
            port: process.env.DB_PORT || 3306,
            user: process.env.DB_USERNAME || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_DATABASE || 'nucleo_crm',
            multipleStatements: true
        });

        console.log('Connected to database!');

        const sqlPath = path.join(__dirname, 'create_admin_campaign_templates.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');

        console.log('Executing migration...');
        await connection.query(sql);
        console.log('Migration executed successfully!');

        await connection.end();
    } catch (err) {
        console.error('Error during migration:', err.message);
    }
}

run();
