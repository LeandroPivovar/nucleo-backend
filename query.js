const mysql = require('mysql2/promise');

async function run() {
    try {
        const connection = await mysql.createConnection({
            host: 'localhost',
            user: 'root',
            password: '',
            database: 'nucleo_crm',
        });
        const [rows] = await connection.execute('SELECT DISTINCT gender FROM contact');
        console.log('Distinct Genders:', rows);
        process.exit(0);
    } catch (error) {
        console.error('Error connecting to database:', error);
        process.exit(1);
    }
}
run();
