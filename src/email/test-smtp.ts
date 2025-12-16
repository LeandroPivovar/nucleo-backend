import { ConfigService } from '@nestjs/config';

/**
 * Script temporário para testar se as variáveis SMTP estão sendo lidas
 * Execute: npx ts-node -r tsconfig-paths/register src/email/test-smtp.ts
 */

const configService = new ConfigService();

console.log('🔍 Verificando variáveis SMTP...\n');

const smtpHost = configService.get<string>('SMTP_HOST');
const smtpPort = configService.get<number>('SMTP_PORT');
const smtpSecure = configService.get<string>('SMTP_SECURE');
const smtpUsername = configService.get<string>('SMTP_USERNAME') || configService.get<string>('SMTP_USER');
const smtpPassword = configService.get<string>('SMTP_PASSWORD') || configService.get<string>('SMTP_PASS');
const smtpFromEmail = configService.get<string>('SMTP_FROM_EMAIL');
const smtpFromName = configService.get<string>('SMTP_FROM_NAME');

console.log('Variáveis encontradas:');
console.log(`  SMTP_HOST: ${smtpHost || '❌ NÃO CONFIGURADO'}`);
console.log(`  SMTP_PORT: ${smtpPort || '❌ NÃO CONFIGURADO'}`);
console.log(`  SMTP_SECURE: ${smtpSecure || '❌ NÃO CONFIGURADO'}`);
console.log(`  SMTP_USERNAME: ${smtpUsername || '❌ NÃO CONFIGURADO'}`);
console.log(`  SMTP_PASSWORD: ${smtpPassword ? '✅ Configurado (oculto)' : '❌ NÃO CONFIGURADO'}`);
console.log(`  SMTP_FROM_EMAIL: ${smtpFromEmail || '❌ NÃO CONFIGURADO'}`);
console.log(`  SMTP_FROM_NAME: ${smtpFromName || '❌ NÃO CONFIGURADO'}`);

console.log('\n📁 Verificando arquivo .env...');
const fs = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '../../.env');

if (fs.existsSync(envPath)) {
  console.log('✅ Arquivo .env encontrado em:', envPath);
  const envContent = fs.readFileSync(envPath, 'utf8');
  const hasSmtpUsername = envContent.includes('SMTP_USERNAME');
  const hasSmtpPassword = envContent.includes('SMTP_PASSWORD');
  console.log(`  - Contém SMTP_USERNAME: ${hasSmtpUsername ? '✅' : '❌'}`);
  console.log(`  - Contém SMTP_PASSWORD: ${hasSmtpPassword ? '✅' : '❌'}`);
} else {
  console.log('❌ Arquivo .env NÃO encontrado em:', envPath);
  console.log('💡 Execute: npm run env:create');
}

if (!smtpUsername || !smtpPassword) {
  console.log('\n❌ ERRO: Credenciais SMTP não configuradas!');
  console.log('💡 Solução:');
  console.log('   1. Execute: npm run env:create');
  console.log('   2. Ou crie manualmente o arquivo .env na pasta backend/');
  console.log('   3. Reinicie o servidor após criar o arquivo');
  process.exit(1);
} else {
  console.log('\n✅ Todas as credenciais SMTP estão configuradas!');
}

