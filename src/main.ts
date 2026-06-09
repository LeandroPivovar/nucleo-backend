import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { DataSource } from 'typeorm';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { json, urlencoded } from 'express';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true, // Necessário para verificar assinatura HMAC dos webhooks da Shopify
  });

  app.use(json({ limit: '50mb' }));
  app.use(urlencoded({ limit: '50mb', extended: true }));

  // Middleware de log de requisições
  app.use((req, res, next) => {
    if (req.url.includes('/uploads/') || req.url.includes('/webhook/')) {
        console.log(`[REQ] ${req.method} ${req.url} from ${req.ip} - User-Agent: ${req.headers['user-agent']}`);
    }
    next();
  });

  // Servir arquivos estáticos da pasta uploads
  app.useStaticAssets(join(__dirname, '..', 'uploads'), {
    prefix: '/uploads/',
  });

  const logger = new Logger('Bootstrap');

  // AUTO-FIX: Forçar adição de colunas faltantes na tabela users (fallback para erro de migration)
  try {
    const dataSource = app.get(DataSource);
    await dataSource.query(`
      ALTER TABLE \`users\` 
      ADD COLUMN \`planId\` int NULL,
      ADD COLUMN \`subscriptionStatus\` varchar(50) NULL,
      ADD COLUMN \`extraEmailsBalance\` int DEFAULT 0,
      ADD COLUMN \`extraSmsBalance\` int DEFAULT 0
    `);
    logger.log('Fallback Migration: Colunas de plano e saldo extra adicionadas com sucesso.');

    // AUTO-FIX: Garantir que usuários existentes sejam marcados como ativos
    await dataSource.query(`
      UPDATE \`users\` SET \`active\` = 1 WHERE \`active\` = 0
    `);
    logger.log('Fallback Migration: Todos os usuários marcados como ativos para evitar bloqueio.');
  } catch (err: any) {
    if (err.code === 'ER_DUP_FIELDNAME') {
      logger.log('Fallback Migration: Colunas de plano e saldo extra já existem.');
    } else {
      logger.error(`Fallback Migration falhou: ${err.message}`);
    }
  }

  // AUTO-FIX: Forçar adição de colunas faltantes na tabela products
  try {
    const dataSource = app.get(DataSource);
    await dataSource.query(`
      ALTER TABLE \`products\` 
      ADD COLUMN \`coverPhoto\` text NULL,
      ADD COLUMN \`gallery\` json NULL
    `);
    logger.log('Fallback Migration: Colunas de fotos adicionadas a products com sucesso.');
  } catch (err: any) {
    if (err.code === 'ER_DUP_FIELDNAME') {
      logger.log('Fallback Migration: Colunas de fotos já existem em products.');
    } else {
      logger.error(`Fallback Migration falhou (products): ${err.message}`);
    }
  }

  // AUTO-FIX: Tabelas e colunas para o Módulo de Indicações e Base de Conhecimento
  try {
    const dataSource = app.get(DataSource);
    
    // Colunas em referrals
    try {
      await dataSource.query(`
        ALTER TABLE \`referrals\` 
        ADD COLUMN \`referredName\` varchar(255) NULL,
        ADD COLUMN \`companyName\` varchar(255) NULL,
        ADD COLUMN \`phone\` varchar(50) NULL,
        ADD COLUMN \`email\` varchar(255) NULL,
        ADD COLUMN \`origin\` varchar(100) NULL,
        ADD COLUMN \`referralCode\` varchar(100) NULL
      `);
    } catch (e) {}

    // Colunas em referral_commissions
    try {
      await dataSource.query(`
        ALTER TABLE \`referral_commissions\`
        ADD COLUMN \`status\` varchar(50) DEFAULT 'pending',
        ADD COLUMN \`commissionType\` varchar(50) DEFAULT 'fixed',
        ADD COLUMN \`expectedPaymentDate\` datetime NULL,
        ADD COLUMN \`paymentDate\` datetime NULL
      `);
    } catch (e) {}

    // Tabela referral_reward_configs
    await dataSource.query(`
      CREATE TABLE IF NOT EXISTS \`referral_reward_configs\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`type\` varchar(50) NOT NULL,
        \`value\` decimal(10,2) NOT NULL,
        \`durationMonths\` int NULL,
        \`description\` varchar(255) NULL,
        \`isActive\` tinyint NOT NULL DEFAULT 1,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB
    `);

    try {
      await dataSource.query(`
        ALTER TABLE \`referral_reward_configs\` 
        ADD COLUMN \`description\` varchar(255) NULL
      `);
    } catch (e) {}

    // Tabela tutorials
    await dataSource.query(`
      CREATE TABLE IF NOT EXISTS \`tutorials\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`title\` varchar(255) NOT NULL,
        \`pdfUrl\` varchar(255) NOT NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB
    `);

    logger.log('Fallback Migration: Estrutura de Indicações e Base de Conhecimento verificada.');
  } catch (err: any) {
    logger.error(`Fallback Migration falhou (referrals/tutorials): ${err.message}`);
  }

  // AUTO-FIX: Aumentar tamanho da coluna state em contacts (para suportar nomes completos como "Pará")
  try {
    const dataSource = app.get(DataSource);
    await dataSource.query(`
      ALTER TABLE \`contacts\` 
      MODIFY COLUMN \`state\` varchar(50) NULL
    `);
    logger.log('Fallback Migration: Tamanho da coluna state em contacts aumentado para 50.');
  } catch (err: any) {
    logger.error(`Fallback Migration falhou (contacts state): ${err.message}`);
  }

  // AUTO-FIX: Forçar adição de colunas faltantes na tabela shopify_connections
  try {
    const dataSource = app.get(DataSource);
    await dataSource.query(`
      ALTER TABLE \`shopify_connections\` 
      ADD COLUMN \`refreshToken\` text NULL,
      ADD COLUMN \`expiresAt\` datetime NULL
    `);
    logger.log('Fallback Migration: Colunas de token renovável adicionadas a shopify_connections com sucesso.');
  } catch (err: any) {
    if (err.code === 'ER_DUP_FIELDNAME') {
      logger.log('Fallback Migration: Colunas de token já existem em shopify_connections.');
    } else {
      logger.error(`Fallback Migration falhou (shopify_connections): ${err.message}`);
    }
  }

  // AUTO-FIX: Tabela bot_flows (construtor de bot — múltiplos fluxos por canal)
  try {
    const dataSource = app.get(DataSource);
    await dataSource.query(`
      CREATE TABLE IF NOT EXISTS \`bot_flows\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`userId\` int NOT NULL,
        \`name\` varchar(150) NOT NULL DEFAULT 'Novo fluxo',
        \`channel\` varchar(50) NOT NULL DEFAULT 'whatsapp_qr',
        \`nodes\` json NULL,
        \`edges\` json NULL,
        \`isActive\` tinyint NOT NULL DEFAULT 0,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        INDEX \`IDX_bot_flows_userId\` (\`userId\`),
        CONSTRAINT \`FK_bot_flows_userId\` FOREIGN KEY (\`userId\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION
      ) ENGINE=InnoDB
    `);
    try {
      await dataSource.query(`
        ALTER TABLE \`bot_flows\`
        ADD COLUMN \`name\` varchar(150) NOT NULL DEFAULT 'Novo fluxo',
        ADD COLUMN \`channel\` varchar(50) NOT NULL DEFAULT 'whatsapp_qr'
      `);
    } catch (e: any) {
      if (e.code !== 'ER_DUP_FIELDNAME') throw e;
    }
    try {
      const indexRows: { NON_UNIQUE: number }[] = await dataSource.query(`
        SELECT NON_UNIQUE FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bot_flows' AND INDEX_NAME = 'IDX_bot_flows_userId'
        LIMIT 1
      `);
      if (indexRows.length > 0 && indexRows[0].NON_UNIQUE === 0) {
        await dataSource.query(`ALTER TABLE \`bot_flows\` DROP FOREIGN KEY \`FK_bot_flows_userId\``);
        await dataSource.query(`ALTER TABLE \`bot_flows\` DROP INDEX \`IDX_bot_flows_userId\``);
        await dataSource.query(`CREATE INDEX \`IDX_bot_flows_userId\` ON \`bot_flows\` (\`userId\`)`);
        await dataSource.query(`
          ALTER TABLE \`bot_flows\`
          ADD CONSTRAINT \`FK_bot_flows_userId\`
          FOREIGN KEY (\`userId\`) REFERENCES \`users\`(\`id\`)
          ON DELETE CASCADE ON UPDATE NO ACTION
        `);
        logger.log('Fallback Migration: Índice userId de bot_flows convertido para não-único.');
      }
    } catch (e: any) {
      logger.warn(`Fallback bot_flows index/FK: ${e.message}`);
    }
    logger.log('Fallback Migration: Tabela bot_flows verificada.');
  } catch (err: any) {
    logger.error(`Fallback Migration falhou (bot_flows): ${err.message}`);
  }

  // AUTO-FIX: Conexões Telegram dos fluxos de bot
  try {
    const dataSource = app.get(DataSource);
    await dataSource.query(`
      CREATE TABLE IF NOT EXISTS \`bot_telegram_connections\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`botFlowId\` int NOT NULL,
        \`userId\` int NOT NULL,
        \`botToken\` text NOT NULL,
        \`telegramBotId\` varchar(32) NOT NULL,
        \`botUsername\` varchar(255) NULL,
        \`webhookSecret\` varchar(64) NOT NULL,
        \`status\` varchar(20) NOT NULL DEFAULT 'connected',
        \`connectedAt\` datetime NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`UQ_bot_telegram_connections_botFlowId\` (\`botFlowId\`),
        UNIQUE INDEX \`UQ_bot_telegram_connections_telegramBotId\` (\`telegramBotId\`),
        CONSTRAINT \`FK_bot_telegram_connections_botFlow\` FOREIGN KEY (\`botFlowId\`) REFERENCES \`bot_flows\`(\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`FK_bot_telegram_connections_user\` FOREIGN KEY (\`userId\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);
    logger.log('Fallback Migration: Tabela bot_telegram_connections verificada.');
  } catch (err: any) {
    logger.error(`Fallback Migration falhou (bot_telegram_connections): ${err.message}`);
  }

  // AUTO-FIX: Sessões de conversa dos bots + chaves Gemini
  try {
    const dataSource = app.get(DataSource);
    await dataSource.query(`
      CREATE TABLE IF NOT EXISTS \`bot_conversation_sessions\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`botFlowId\` int NOT NULL,
        \`chatId\` varchar(64) NOT NULL,
        \`currentNodeId\` varchar(100) NULL,
        \`waitingAtNodeId\` varchar(100) NULL,
        \`status\` varchar(20) NOT NULL DEFAULT 'active',
        \`history\` json NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`UQ_bot_sessions_flow_chat\` (\`botFlowId\`, \`chatId\`),
        CONSTRAINT \`FK_bot_sessions_flow\` FOREIGN KEY (\`botFlowId\`) REFERENCES \`bot_flows\`(\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);
    await dataSource.query(`
      INSERT INTO system_settings (\`key\`, \`value\`, description)
      SELECT 'GEMINI_API_KEY', '', 'Chave da API Google Gemini para bots com IA'
      WHERE NOT EXISTS (SELECT 1 FROM system_settings WHERE \`key\` = 'GEMINI_API_KEY')
    `);
    await dataSource.query(`
      INSERT INTO system_settings (\`key\`, \`value\`, description)
      SELECT 'GEMINI_MODEL', 'gemini-2.0-flash', 'Modelo Gemini (ex: gemini-2.0-flash)'
      WHERE NOT EXISTS (SELECT 1 FROM system_settings WHERE \`key\` = 'GEMINI_MODEL')
    `);
    await dataSource.query(`
      INSERT INTO system_settings (\`key\`, \`value\`, description)
      SELECT 'PAYMENT_GATEWAY', 'asaas', 'Gateway principal de pagamento (asaas | shopify)'
      WHERE NOT EXISTS (SELECT 1 FROM system_settings WHERE \`key\` = 'PAYMENT_GATEWAY')
    `);
    await dataSource.query(`
      INSERT INTO system_settings (\`key\`, \`value\`, description)
      SELECT 'SHOPIFY_DEFAULT_SHOP', '', 'Loja Shopify padrão usada como fallback no checkout via Shopify Billing'
      WHERE NOT EXISTS (SELECT 1 FROM system_settings WHERE \`key\` = 'SHOPIFY_DEFAULT_SHOP')
    `);
    logger.log('Fallback Migration: bot_conversation_sessions e Gemini/Payment settings verificados.');
  } catch (err: any) {
    logger.error(`Fallback Migration falhou (bot sessions/gemini): ${err.message}`);
  }

// Habilitar CORS para o frontend
  app.enableCors({
    origin: (origin, callback) => {
      // Permitir qualquer origem para que o pixel funcione em sites externos
      callback(null, true);
    },
    credentials: true,
  });

  // AUTO-FIX: Tabela internal_analytics
  try {
    const dataSource = app.get(DataSource);
    await dataSource.query(`
      CREATE TABLE IF NOT EXISTS \`internal_analytics\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`userId\` int NULL,
        \`type\` varchar(50) NOT NULL,
        \`name\` varchar(100) NOT NULL,
        \`metadata\` json NULL,
        \`timestamp\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        KEY \`IDX_internal_analytics_userId\` (\`userId\`),
        KEY \`IDX_internal_analytics_type\` (\`type\`),
        KEY \`IDX_internal_analytics_name\` (\`name\`),
        KEY \`IDX_internal_analytics_timestamp\` (\`timestamp\`)
      ) ENGINE=InnoDB
    `);
    logger.log('Fallback Migration: Tabela internal_analytics verificada.');
  } catch (err: any) {
    logger.error(`Fallback Migration falhou (internal_analytics): ${err.message}`);
  }

  // AUTO-FIX: Tabelas Kanban
  try {
    const dataSource = app.get(DataSource);
    await dataSource.query(`
      CREATE TABLE IF NOT EXISTS \`kanban_columns\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`userId\` int NOT NULL,
        \`name\` varchar(100) NOT NULL,
        \`description\` text NULL,
        \`order\` int NOT NULL DEFAULT '0',
        \`active\` tinyint(1) NOT NULL DEFAULT '1',
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        KEY \`IDX_kanban_columns_userId\` (\`userId\`)
      ) ENGINE=InnoDB
    `);
    await dataSource.query(`
      CREATE TABLE IF NOT EXISTS \`kanban_cards\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`userId\` int NOT NULL,
        \`columnId\` int NOT NULL,
        \`title\` varchar(200) NOT NULL,
        \`description\` text NULL,
        \`order\` int NOT NULL DEFAULT '0',
        \`active\` tinyint(1) NOT NULL DEFAULT '1',
        \`metadata\` json NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        KEY \`IDX_kanban_cards_userId\` (\`userId\`),
        KEY \`IDX_kanban_cards_columnId\` (\`columnId\`)
      ) ENGINE=InnoDB
    `);
    await dataSource.query(`
      CREATE TABLE IF NOT EXISTS \`email_templates\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`userId\` int NOT NULL,
        \`name\` varchar(150) NOT NULL,
        \`category\` enum('transactional','marketing','notification','custom') NOT NULL DEFAULT 'custom',
        \`html\` longtext NOT NULL,
        \`subject\` varchar(200) NULL,
        \`description\` varchar(255) NULL,
        \`active\` tinyint(1) NOT NULL DEFAULT '1',
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        KEY \`IDX_email_templates_userId\` (\`userId\`),
        KEY \`IDX_email_templates_category\` (\`category\`)
      ) ENGINE=InnoDB
    `);
    logger.log('Fallback Migration: Tabelas kanban_columns, kanban_cards, email_templates verificadas.');
  } catch (err: any) {
    logger.error(`Fallback Migration falhou (kanban/email_templates): ${err.message}`);
  }

  // Prefixo global da API
  app.setGlobalPrefix('api');

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
    }),
  );

  await app.listen(process.env.PORT ?? 3000);
  console.log(`🚀 Backend rodando em http://localhost:${process.env.PORT ?? 3000}`);
}
bootstrap();
