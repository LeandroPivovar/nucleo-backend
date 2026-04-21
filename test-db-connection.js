require('dotenv').config();
const mysql = require('mysql2/promise');

async function test() {
  console.log('Testing connection...');
  try {
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST || '127.0.0.1',
      port: process.env.DB_PORT || 3306,
      user: process.env.DB_USERNAME || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_DATABASE || 'nucleo_crm'
    });
    console.log('Connection SUCCESS');
    const [rows] = await connection.execute('SELECT 1 + 1 AS result');
    console.log('Query RESULT:', rows[0].result);
    await connection.end();
  } catch (err) {
    console.error('Connection FAILED:', err);
  }
}

test();
