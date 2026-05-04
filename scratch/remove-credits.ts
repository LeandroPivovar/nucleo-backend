import { DataSource } from 'typeorm';
import { User } from '../src/entities/user.entity';
import { Plan } from '../src/entities/plan.entity';
import 'dotenv/config';

async function removeCredits() {
    const dataSource = new DataSource({
        type: 'mysql',
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '3306'),
        username: process.env.DB_USERNAME || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_DATABASE || 'nucleo_crm',
        entities: [User, Plan],
    });

    try {
        await dataSource.initialize();
        console.log("Conectado ao banco de dados.");

        const userRepo = dataSource.getRepository(User);
        const email = 'leandrocaetanopivovarr@gmail.com';

        const user = await userRepo.findOne({ where: { email } });

        if (!user) {
            console.error(`Usuário com email ${email} não encontrado.`);
            return;
        }

        console.log(`Usuário encontrado: ${user.firstName} ${user.lastName} (ID: ${user.id})`);
        console.log(`Créditos atuais do WhatsApp: ${user.extraWhatsappBalance}`);

        user.extraWhatsappBalance = 0;
        await userRepo.save(user);

        console.log(`Sucesso: Créditos de WhatsApp do usuário ${email} removidos (zerados).`);
    } catch (error) {
        console.error("Erro ao remover créditos:", error);
    } finally {
        if (dataSource.isInitialized) {
            await dataSource.destroy();
        }
    }
}

removeCredits();
