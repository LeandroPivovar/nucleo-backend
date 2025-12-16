import { createConnection } from 'mysql2/promise';
import { config } from 'dotenv';

config();

async function createDatabase() {
  const host = process.env.DB_HOST || 'localhost';
  const port = parseInt(process.env.DB_PORT || '3306');
  const username = process.env.DB_USERNAME || 'root';
  const password = process.env.DB_PASSWORD || '';
  const database = process.env.DB_DATABASE || 'nucleo_crm';

  console.log('🔧 Criando banco de dados...');

  try {
    // Conectar sem especificar o banco de dados
    const connection = await createConnection({
      host,
      port,
      user: username,
      password,
    });

    // Criar o banco de dados se não existir
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    
    console.log(`✅ Banco de dados '${database}' criado ou já existe!`);
    
    await connection.end();
    process.exit(0);
  } catch (error: any) {
    if (error.code === 'ECONNREFUSED') {
      console.error('❌ Erro: Não foi possível conectar ao MySQL.');
      console.error('   Verifique se o MySQL está rodando.');
    } else if (error.code === 'ER_ACCESS_DENIED_ERROR') {
      console.error('❌ Erro: Acesso negado ao MySQL.');
      console.error('   Verifique as credenciais no arquivo .env');
    } else {
      console.error('❌ Erro ao criar banco de dados:', error.message);
    }
    process.exit(1);
  }
}

createDatabase();

