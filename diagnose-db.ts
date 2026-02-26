import { AppDataSource } from './src/database/data-source';

async function diagnose() {
    try {
        await AppDataSource.initialize();
        console.log('✅ Conectado ao banco de dados');
        console.log('📂 Banco de Dados configurado:', AppDataSource.options.database);

        const queryRunner = AppDataSource.createQueryRunner();

        // Verifica qual o banco de dados atual no MySQL
        const currentDb = await queryRunner.query('SELECT DATABASE() as db');
        console.log('🖥️ Banco de Dados em uso na conexão:', currentDb[0].db);

        const columns = await queryRunner.query('SHOW COLUMNS FROM users');

        console.log('\n📊 Colunas na tabela "users":');
        console.table(columns.map((c: any) => ({
            Campo: c.Field,
            Tipo: c.Type,
            Nulo: c.Null,
            Chave: c.Key,
            Extra: c.Extra
        })));

        await AppDataSource.destroy();
    } catch (error) {
        console.error('❌ Erro no diagnóstico:', error);
    }
}

diagnose();
