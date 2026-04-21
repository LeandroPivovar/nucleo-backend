require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

async function migrate() {
    console.log('Iniciando migração...');
    try {
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST || '127.0.0.1',
            port: process.env.DB_PORT || 3306,
            user: process.env.DB_USERNAME || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_DATABASE || 'nucleo_crm',
            multipleStatements: true
        });

        console.log('Conectado ao banco de dados.');

        const sqlPath = path.join(__dirname, 'add_role_to_users.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');

        await connection.query(sql);
        console.log('Migração concluída com sucesso!');
        
        const [rows] = await connection.execute('SELECT email, role FROM users WHERE email = ?', ['leandrocaetanopivovarr@gmail.com']);
        console.log('Status final do usuário:', rows[0]);

        await connection.end();
    } catch (err) {
        console.error('Erro na migração:', err.message);
    }
}

migrate();
