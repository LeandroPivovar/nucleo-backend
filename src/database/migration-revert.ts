import { AppDataSource } from './data-source';

AppDataSource.initialize()
  .then(async () => {
    console.log('🔄 Revertendo última migration...');
    await AppDataSource.undoLastMigration();
    console.log('✅ Migration revertida com sucesso!');
    
    await AppDataSource.destroy();
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Erro ao reverter migration:', error);
    process.exit(1);
  });

