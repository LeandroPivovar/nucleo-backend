const mysql = require('mysql2/promise');

async function run() {
    try {
        const connection = await mysql.createConnection({
            host: 'localhost',
            user: 'root',
            password: '',
            database: 'nucleo_crm',
        });
        const [rows] = await connection.execute('SELECT id, name, limits, active, visible FROM plans');
        console.log('Plans:', rows);
        process.exit(0);
    } catch (error) {
        console.error('Error connecting to database:', error);
        process.exit(1);
    }
}
run();
