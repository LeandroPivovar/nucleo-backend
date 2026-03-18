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

        console.log('Connected to database!');

        const [users] = await connection.execute('SELECT COUNT(*) as count FROM users');
        console.log('Users count:', users[0].count);

        const [plans] = await connection.execute('SELECT COUNT(*) as count FROM plans');
        console.log('Plans count:', plans[0].count);

        const [subscriptions] = await connection.execute('SELECT COUNT(*) as count FROM subscriptions');
        console.log('Subscriptions count:', subscriptions[0].count);

        const [invoices] = await connection.execute('SELECT COUNT(*) as count FROM invoices');
        console.log('Invoices count:', invoices[0].count);

        await connection.end();
    } catch (err) {
        console.error('Error:', err.message);
    }
}

check();
