import { AppDataSource } from './src/database/data-source';

async function test() {
  try {
    await AppDataSource.initialize();
    console.log('Connected');
    const migrations = await AppDataSource.runMigrations();
    console.log('Migrations run:', migrations);
    await AppDataSource.destroy();
  } catch (err) {
    console.error('FULL ERROR:', err);
    process.exit(1);
  }
}

test();
