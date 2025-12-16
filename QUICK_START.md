# Guia Rápido de Início

## 1. Criar o Banco de Dados

Execute no MySQL:
```sql
CREATE DATABASE nucleo_crm;
```

Ou use o script SQL:
```bash
mysql -u root < scripts/create-database.sql
```

## 2. Configurar Variáveis de Ambiente

O arquivo `.env` já está criado com as configurações padrão:
- DB_HOST=localhost
- DB_PORT=3306
- DB_USERNAME=root
- DB_PASSWORD= (vazio)
- DB_DATABASE=nucleo_crm

## 3. Instalar Dependências e Executar Migrations

```bash
npm install
npm run migration:run
```

## 4. Iniciar o Servidor

```bash
npm run start:dev
```

O backend estará rodando em `http://localhost:3000`

## 5. Testar a API

### Registrar um usuário:
```bash
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "João",
    "lastName": "Silva",
    "email": "joao@example.com",
    "password": "senha123"
  }'
```

### Fazer login:
```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "joao@example.com",
    "password": "senha123"
  }'
```

## Frontend

O frontend já está configurado para se conectar ao backend em `http://localhost:3000`.

Para iniciar o frontend:
```bash
cd ../frontend
npm install
npm run dev
```

O frontend estará rodando em `http://localhost:8080`

