# Como Rodar o Backend e Migrations

## 🚀 Sistema de Migrations Integrado ao NestJS

As migrations agora são executadas através de scripts TypeScript integrados ao NestJS, sem necessidade de arquivos SQL separados.

## Passo 1: Criar o Banco de Dados MySQL

**Opção A - Automático (Recomendado):**
```bash
npm run db:create
```

**Opção B - Manual (se tiver MySQL no PATH):**
```bash
mysql -u root -e "CREATE DATABASE nucleo_crm;"
```

**Opção C - Via MySQL Workbench ou phpMyAdmin:**
Execute o SQL:
```sql
CREATE DATABASE nucleo_crm;
```

## Passo 2: Configurar Variáveis de Ambiente

**IMPORTANTE:** Crie o arquivo `.env` na raiz do backend com as credenciais SMTP.

**Opção A - Automático (Recomendado):**
```bash
cd backend
npm run env:create
```

**Opção B - Manual:**
Crie um arquivo `.env` na pasta `backend/` com o seguinte conteúdo:

```env
# Database
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
```

## Passo 3: Instalar Dependências (se ainda não instalou)

Certifique-se de estar na pasta `backend` e instale as dependências:

```bash
cd backend
npm install
```

## Passo 4: Executar as Migrations

**OU use o comando completo que faz tudo:**
```bash
npm run setup  # Cria banco + executa migrations
```

**Ou execute separadamente:**

Execute as migrations para criar as tabelas no banco de dados:

```bash
npm run migration:run
```

Isso irá:
- Conectar ao banco de dados MySQL usando a configuração do NestJS
- Executar todas as migrations pendentes
- Criar as tabelas necessárias (incluindo a tabela `users`)

## Passo 5: Iniciar o Backend

Para desenvolvimento (com hot-reload):
```bash
npm run start:dev
```

Para produção:
```bash
npm run build
npm run start:prod
```

O servidor estará rodando em `http://localhost:3000`

---

## 📋 Comandos de Migration Disponíveis

### Executar migrations pendentes:
```bash
npm run migration:run
```

### Ver status das migrations:
```bash
npm run migration:show
```

### Reverter última migration:
```bash
npm run migration:revert
```

### Criar nova migration:
```bash
npm run migration:generate -- NomeDaMigration
```

**Exemplo:**
```bash
npm run migration:generate -- AddPhoneToUsers
```

Isso criará um arquivo em `src/migrations/` com um template que você pode editar.

---

## 🔍 Verificar se está funcionando

Após iniciar o backend, você verá uma mensagem:
```
🚀 Backend rodando em http://localhost:3000
```

Teste o endpoint de registro:
```bash
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d "{\"firstName\":\"Teste\",\"lastName\":\"Usuario\",\"email\":\"teste@teste.com\",\"password\":\"senha123\"}"
```

---

## ❌ Troubleshooting

### Erro de conexão com MySQL:
- Verifique se o MySQL está rodando
- Confirme as credenciais no arquivo `.env`
- Verifique se o banco `nucleo_crm` foi criado

### Erro ao executar migrations:
- Certifique-se de que o banco de dados existe
- Verifique as credenciais no `.env`
- Tente executar `npm run migration:show` para ver o status

### Porta 3000 já em uso:
- Altere a porta no arquivo `.env`: `PORT=3001`
- Ou pare o processo que está usando a porta 3000

### Migration não encontrada:
- Certifique-se de que o arquivo está em `src/migrations/`
- Verifique se o nome da classe corresponde ao nome do arquivo
- Execute `npm run build` antes de rodar migrations em produção

---

## 📁 Estrutura das Migrations

As migrations são arquivos TypeScript em `src/migrations/` que implementam a interface `MigrationInterface`:

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

export class NomeDaMigration1234567890 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Código para aplicar a migration
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Código para reverter a migration
  }
}
```

---

## ✅ Sequência Completa (Copiar e Colar)

```bash
# 1. Criar banco (no MySQL)
mysql -u root -e "CREATE DATABASE nucleo_crm;"

# 2. Ir para pasta backend
cd backend

# 3. Instalar dependências
npm install

# 4. Executar migrations
npm run migration:run

# 5. Iniciar servidor
npm run start:dev
```

---

## 📧 Configuração de E-mail (SMTP)

O sistema possui um helper para envio de e-mails via SMTP. Para configurar:

### 1. Adicionar variáveis de ambiente no `.env`:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=tls
SMTP_USERNAME=suporte.ultra.academy@gmail.com
SMTP_PASSWORD=zgri migf nurw hmqy
SMTP_FROM_EMAIL=suporte.ultra.academy@gmail.com
SMTP_FROM_NAME=ULTRA Academy
FRONTEND_URL=http://localhost:8080
```

**Nota:** O sistema também aceita `SMTP_USER`/`SMTP_PASS` como alternativas a `SMTP_USERNAME`/`SMTP_PASSWORD`.

### 2. Para Gmail:
- Use uma "Senha de App" ao invés da senha normal
- Ative a verificação em duas etapas
- Gere uma senha de app em: https://myaccount.google.com/apppasswords

### 3. Exemplo de uso:

```typescript
import { EmailHelper } from './email/email.helper';

constructor(private emailHelper: EmailHelper) {}

// Enviar e-mail genérico
await this.emailHelper.send({
  to: 'usuario@email.com',
  subject: 'Assunto',
  html: '<h1>Conteúdo HTML</h1>',
});

// Enviar e-mail de boas-vindas
await this.emailHelper.sendWelcome('usuario@email.com', 'Nome do Usuário');

// Enviar e-mail de redefinição de senha
await this.emailHelper.sendPasswordReset('usuario@email.com', 'token123');
```
