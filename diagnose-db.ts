import { AppDataSource } from './src/database/data-source';

async function diagnose() {
    try {
        await AppDataSource.initialize();
        console.log('✅ Conectado ao banco de dados');

        const queryRunner = AppDataSource.createQueryRunner();
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
