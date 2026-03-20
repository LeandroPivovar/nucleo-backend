const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../../.env') });

async function createTable() {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '3306'),
        user: process.env.DB_USERNAME || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_DATABASE || 'nucleo_crm',
    });

    console.log('Connected to database.');

    const createTableQuery = `
        CREATE TABLE IF NOT EXISTS campaign_queue (
            id INT NOT NULL AUTO_INCREMENT,
            user_id INT NOT NULL,
            campaign_id INT NOT NULL,
            contact_id INT NOT NULL,
            delay_node_id VARCHAR(100) NOT NULL,
            resume_at DATETIME NOT NULL,
            eventContext JSON NULL,
            status VARCHAR(50) NOT NULL DEFAULT 'pending',
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            PRIMARY KEY (id),
            INDEX FK_CQ_User (user_id),
            INDEX FK_CQ_Campaign (campaign_id),
            INDEX FK_CQ_Contact (contact_id)
        ) ENGINE=InnoDB;
    `;

    try {
        await connection.query(createTableQuery);
        console.log('Table campaign_queue created successfully (or already exists).');
    } catch (error) {
        console.error('Error creating table:', error);
    } finally {
        await connection.end();
    }
}

createTable();
