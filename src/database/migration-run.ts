import { AppDataSource } from './data-source';

AppDataSource.initialize()
  .then(async () => {
    console.log('📦 Executando migrations...');
    const migrations = await AppDataSource.runMigrations();
    
    if (migrations.length === 0) {
      console.log('✅ Nenhuma migration pendente.');
    } else {
      console.log(`✅ ${migrations.length} migration(s) executada(s) com sucesso:`);
      migrations.forEach((migration) => {
        console.log(`   - ${migration.name}`);
      });
    }
    
    await AppDataSource.destroy();
    process.exit(0);
  })
  .catch((error: any) => {
    if (error.code === 'ER_BAD_DB_ERROR') {
      console.error('❌ Banco de dados não encontrado!');
      console.error('   Execute primeiro: npm run db:create');
      console.error('   Ou: npm run setup (cria banco e executa migrations)');
    } else {
      console.error('❌ Erro ao executar migrations:', error);
    }
    process.exit(1);
  });

