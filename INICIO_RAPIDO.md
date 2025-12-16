# 🚀 Início Rápido - Backend e Migrations

## ⚠️ IMPORTANTE: Execute na ordem!

### 1️⃣ Instalar Dependências

```bash
cd backend
npm install
```

### 2️⃣ Criar o Banco de Dados (Automático)

O script criará o banco automaticamente:

```bash
npm run db:create
```

**Ou use o comando completo que cria o banco E executa as migrations:**
```bash
npm run setup
```

### 3️⃣ Executar as Migrations

Se você não usou `npm run setup`, execute:

```bash
npm run migration:run
```

**O que isso faz?**
- Conecta ao banco `nucleo_crm` usando a configuração do NestJS
- Cria a tabela `users` com todos os campos
- Registra as migrations executadas na tabela `migrations`

### 4️⃣ Iniciar o Backend

```bash
npm run start:dev
```

Você verá:
```
🚀 Backend rodando em http://localhost:3000
```

---

## 📋 Comandos Completos (Copiar e Colar)

```bash
# 1. Ir para pasta backend
cd backend

# 2. Instalar dependências
npm install

# 3. Criar banco e executar migrations (TUDO DE UMA VEZ!)
npm run setup

# 4. Iniciar servidor
npm run start:dev
```

**OU passo a passo:**

```bash
# 1. Ir para pasta backend
cd backend

# 2. Instalar dependências
npm install

# 3. Criar banco de dados
npm run db:create

# 4. Executar migrations
npm run migration:run

# 5. Iniciar servidor
npm run start:dev
```

---

## 🔧 Comandos Disponíveis

### Criar banco de dados:
```bash
npm run db:create
```

### Ver status das migrations:
```bash
npm run migration:show
```

### Criar nova migration:
```bash
npm run migration:generate -- NomeDaMigration
```

### Reverter última migration:
```bash
npm run migration:revert
```

### Setup completo (cria banco + migrations):
```bash
npm run setup
```

---

## 🔍 Verificar se Funcionou

### Testar o endpoint de registro:
```bash
curl -X POST http://localhost:3000/auth/register -H "Content-Type: application/json" -d "{\"firstName\":\"João\",\"lastName\":\"Silva\",\"email\":\"joao@teste.com\",\"password\":\"senha123\"}"
```

### Ou use o Postman/Insomnia:
- **URL:** `POST http://localhost:3000/auth/register`
- **Body (JSON):**
```json
{
  "firstName": "João",
  "lastName": "Silva",
  "email": "joao@teste.com",
  "password": "senha123"
}
```

---

## ❌ Problemas Comuns

### "Unknown database 'nucleo_crm'"
**Solução:** Execute `npm run db:create` primeiro

### "ECONNREFUSED" ou "Não foi possível conectar ao MySQL"
**Solução:** 
- Verifique se o MySQL está rodando
- No Windows: Verifique no "Serviços" se o MySQL está iniciado
- Tente iniciar: `net start MySQL` (como administrador)

### "Access denied for user 'root'"
**Solução:** 
- Verifique se o MySQL está rodando
- Verifique as credenciais no arquivo `.env`
- Se você tem senha no root, adicione no `.env`: `DB_PASSWORD=sua_senha`

### "Port 3000 is already in use"
**Solução:** 
- Pare o processo na porta 3000, ou
- Altere `PORT=3001` no arquivo `.env`

### Migration não executa
**Solução:** 
- Execute `npm run db:create` primeiro
- Verifique as credenciais no `.env`
- Tente: `npm run migration:show` para ver o status

---

## 📚 Como Funciona

As migrations são executadas através de scripts TypeScript integrados ao NestJS:
- `src/database/data-source.ts` - Configuração do DataSource
- `src/database/create-database.ts` - Cria o banco automaticamente
- `src/database/migration-run.ts` - Executa migrations
- `src/database/migration-show.ts` - Mostra status
- `src/database/migration-revert.ts` - Reverte migrations
- `src/database/migration-generate.ts` - Cria novas migrations

Tudo integrado ao NestJS, sem necessidade de comandos MySQL no PATH! 🎉
