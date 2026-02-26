import { AppDataSource } from './src/database/data-source';

async function diagnoseAndFix() {
    try {
        await AppDataSource.initialize();
        console.log('✅ Conectado ao banco de dados:', AppDataSource.options.database);

        const queryRunner = AppDataSource.createQueryRunner();

        console.log('🛠️ Tentando adicionar colunas faltantes...');

        const columnsToFix = [
            { name: 'referralCode', sql: 'ALTER TABLE users ADD COLUMN `referralCode` VARCHAR(20) NULL UNIQUE' },
            { name: 'referredById', sql: 'ALTER TABLE users ADD COLUMN `referredById` INT NULL' }
        ];

        for (const item of columnsToFix) {
            try {
                console.log(`⏳ Executando: ${item.sql}`);
                await queryRunner.query(item.sql);
                console.log(`✅ Coluna "${item.name}" adicionada com sucesso.`);
            } catch (err: any) {
                if (err.code === 'ER_DUP_FIELDNAME') {
                    console.log(`⚠️ Coluna "${item.name}" já existe.`);
                } else {
                    console.error(`❌ Erro ao adicionar "${item.name}":`, err.message);
                }
            }
        }

        const columns = await queryRunner.query('SHOW COLUMNS FROM users');
        console.log('\n📊 Estado atual das colunas na tabela "users":');
        console.table(columns.map((c: any) => ({
            Campo: c.Field,
            Tipo: c.Type,
            Nulo: c.Null,
            Chave: c.Key
        })));

        await AppDataSource.destroy();
    } catch (error) {
        console.error('❌ Erro no processo:', error);
    }
}

diagnoseAndFix();
