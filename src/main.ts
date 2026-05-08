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

  // Habilitar CORS para o frontend
  app.enableCors({
    origin: (origin, callback) => {
      // Permitir qualquer origem para que o pixel funcione em sites externos
      callback(null, true);
    },
    credentials: true,
  });

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
