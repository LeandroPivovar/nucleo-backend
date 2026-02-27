import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { DataSource } from 'typeorm';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    rawBody: true, // Necessário para verificar assinatura HMAC dos webhooks da Shopify
  });

  const logger = new Logger('Bootstrap');

  // AUTO-FIX: Forçar adição de colunas faltantes na tabela users (fallback para erro de migration)
  try {
    const dataSource = app.get(DataSource);
    await dataSource.query(`
      ALTER TABLE \`users\` 
      ADD COLUMN \`planId\` int NULL,
      ADD COLUMN \`subscriptionStatus\` varchar(50) NULL
    `);
    logger.log('Fallback Migration: Colunas planId e subscriptionStatus adicionadas com sucesso.');
  } catch (err: any) {
    if (err.code === 'ER_DUP_FIELDNAME') {
      logger.log('Fallback Migration: Colunas planId e subscriptionStatus já existem.');
    } else {
      logger.error(`Fallback Migration falhou: ${err.message}`);
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
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.listen(process.env.PORT ?? 3000);
  console.log(`🚀 Backend rodando em http://localhost:${process.env.PORT ?? 3000}`);
}
bootstrap();
