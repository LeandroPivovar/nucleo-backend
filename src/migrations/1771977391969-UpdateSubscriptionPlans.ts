import { MigrationInterface, QueryRunner } from "typeorm";

export class UpdateSubscriptionPlans1771977391969 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Obter os IDs dos 3 primeiros planos, caso os nomes originais não fossem "Starter/Pro/Enterprise"

        // Plano 1: Basic
        await queryRunner.query(`
            UPDATE plans 
            SET name = 'Basic', 
                price = 139.99,
                features = '["Criação de até 5 campanhas avançadas por mês", "Criação de campanhas simples ilimitadas", "A cobrança será realizada de forma recorrente mensal", "O cliente poderá solicitar upgrade ou downgrade de plano a qualquer momento", "O não pagamento poderá acarretar na suspensão temporária dos serviços", "Alterações passarão a valer no próximo ciclo de faturamento", "Os valores poderão ser reajustados mediante aviso prévio de 30 dias"]',
                limits = '{"contacts": 2000, "emails": 5000, "whatsapp": false, "sms": 500, "advancedCampaigns": 5}'
            WHERE id = 1
        `);

        // Plano 2: Pro
        await queryRunner.query(`
            UPDATE plans 
            SET name = 'Pro', 
                price = 199.99,
                features = '["Criação de campanhas simples e avançadas ilimitadas", "A cobrança será realizada de forma recorrente mensal", "O cliente poderá solicitar upgrade ou downgrade de plano a qualquer momento", "O não pagamento poderá acarretar na suspensão temporária dos serviços", "Alterações passarão a valer no próximo ciclo de faturamento", "Os valores poderão ser reajustados mediante aviso prévio de 30 dias"]',
                limits = '{"contacts": 10000, "emails": 8000, "whatsapp": true, "sms": 800, "advancedCampaigns": -1}'
            WHERE id = 2
        `);

        // Plano 3: Enterprise
        await queryRunner.query(`
            UPDATE plans 
            SET name = 'Enterprise', 
                price = 399.99,
                features = '["Criação de campanhas simples e avançadas ilimitadas", "A cobrança será realizada de forma recorrente mensal", "O cliente poderá solicitar upgrade ou downgrade de plano a qualquer momento", "O não pagamento poderá acarretar na suspensão temporária dos serviços", "Alterações passarão a valer no próximo ciclo de faturamento", "Os valores poderão ser reajustados mediante aviso prévio de 30 dias"]',
                limits = '{"contacts": 50000, "emails": 20000, "whatsapp": true, "sms": 2000, "advancedCampaigns": -1}'
            WHERE id = 3
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Reverter para os planos Originais caso dê problema
        await queryRunner.query(`
            UPDATE plans 
            SET name = 'Starter', 
                price = 47.00,
                features = '["Até 2.000 contatos", "E-mail marketing", "Templates básicos"]',
                limits = '{"contacts": 2000, "emails": 10000, "whatsapp": false, "sms": false}'
            WHERE id = 1
        `);

        await queryRunner.query(`
            UPDATE plans 
            SET name = 'Pro', 
                price = 97.00,
                features = '["Até 10.000 contatos", "Todos os canais", "Analytics avançados", "Automações ilimitadas"]',
                limits = '{"contacts": 10000, "emails": 50000, "whatsapp": true, "sms": true}'
            WHERE id = 2
        `);

        await queryRunner.query(`
            UPDATE plans 
            SET name = 'Enterprise', 
                price = 247.00,
                features = '["Até 50.000 contatos", "Recursos avançados", "API completa", "Gerente dedicado"]',
                limits = '{"contacts": 50000, "emails": 250000, "whatsapp": true, "sms": true}'
            WHERE id = 3
        `);
    }

}
