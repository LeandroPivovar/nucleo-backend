const fs = require('fs');
const path = require('path');

const envContent = `# Database
DB_HOST=localhost
DB_PORT=3306
DB_USERNAME=root
DB_PASSWORD=
DB_DATABASE=nucleo_crm

# JWT
JWT_SECRET=your-secret-key-change-in-production

# SMTP Configuration - ULTRA Academy
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=tls
SMTP_USERNAME=suporte.ultra.academy@gmail.com
SMTP_PASSWORD=zgri migf nurw hmqy
SMTP_FROM_EMAIL=suporte.ultra.academy@gmail.com
SMTP_FROM_NAME=ULTRA Academy

# Frontend URL
FRONTEND_URL=http://localhost:8080
`;

const envPath = path.join(__dirname, '.env');

if (fs.existsSync(envPath)) {
  console.log('⚠️  Arquivo .env já existe!');
  console.log('📝 Se quiser recriar, delete o arquivo .env primeiro.');
  process.exit(0);
}

try {
  fs.writeFileSync(envPath, envContent, 'utf8');
  console.log('✅ Arquivo .env criado com sucesso!');
  console.log('📧 Credenciais SMTP configuradas:');
  console.log('   - Host: smtp.gmail.com');
  console.log('   - Port: 587');
  console.log('   - User: suporte.ultra.academy@gmail.com');
  console.log('');
  console.log('⚠️  IMPORTANTE:');
  console.log('   - A senha deve ser uma "Senha de App" do Gmail');
  console.log('   - Se não funcionar, gere uma nova em:');
  console.log('     https://myaccount.google.com/apppasswords');
  console.log('');
  console.log('🔄 Reinicie o backend para aplicar as mudanças:');
  console.log('   npm run start:dev');
} catch (error) {
  console.error('❌ Erro ao criar arquivo .env:', error.message);
  process.exit(1);
}

