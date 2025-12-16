import { AppDataSource } from './data-source';

AppDataSource.initialize()
  .then(async () => {
    console.log('📊 Status das migrations:\n');
    
    try {
      const pendingMigrations = await AppDataSource.showMigrations();
      const executedMigrations = await AppDataSource.query(
        'SELECT * FROM migrations ORDER BY timestamp DESC'
      ).catch(() => []);

      if (executedMigrations.length > 0) {
        console.log('✅ Migrations executadas:');
        executedMigrations.forEach((migration: any) => {
          const date = migration.timestamp 
            ? new Date(parseInt(migration.timestamp) * 1000).toLocaleString()
            : 'N/A';
          console.log(`   - ${migration.name} (${date})`);
        });
      }

      if (pendingMigrations) {
        console.log('\n⏳ Migrations pendentes detectadas.');
        console.log('   Execute "npm run migration:run" para executar');
      } else {
        console.log('\n✅ Todas as migrations foram executadas.');
      }
    } catch (error: any) {
      if (error.code === 'ER_NO_SUCH_TABLE') {
        console.log('ℹ️  Tabela de migrations não encontrada.');
        console.log('   Execute "npm run migration:run" para criar as tabelas.');
      } else {
        throw error;
      }
    }
    
    await AppDataSource.destroy();
    process.exit(0);
  })
  .catch((error: any) => {
    if (error.code === 'ER_BAD_DB_ERROR') {
      console.error('❌ Banco de dados não encontrado. Crie o banco "nucleo_crm" primeiro.');
    } else {
      console.error('❌ Erro ao verificar migrations:', error.message);
    }
    process.exit(1);
  });

