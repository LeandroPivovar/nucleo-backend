# Backend Núcleo CRM

Backend desenvolvido com NestJS, TypeORM e MySQL.

## Pré-requisitos

- Node.js (v18 ou superior)
- MySQL instalado e rodando
- npm ou yarn

## Configuração

1. Instale as dependências:
```bash
npm install
```

2. Configure as variáveis de ambiente criando um arquivo `.env` na raiz do projeto:
```env
DB_HOST=localhost
DB_PORT=3306
DB_USERNAME=root
DB_PASSWORD=
DB_DATABASE=nucleo_crm

JWT_SECRET=your-secret-key-change-in-production

PORT=3000
```

3. Crie o banco de dados MySQL:
```sql
CREATE DATABASE nucleo_crm;
```

4. Execute as migrations:
```bash
npm run migration:run
```

## Executando o projeto

### Desenvolvimento
```bash
npm run start:dev
```

O servidor estará rodando em `http://localhost:3000`

### Produção
```bash
npm run build
npm run start:prod
```

## Migrations

### Criar uma nova migration
```bash
npm run migration:generate -- src/migrations/NomeDaMigration
```

### Executar migrations
```bash
npm run migration:run
```

### Reverter última migration
```bash
npm run migration:revert
```

## Estrutura do Projeto

```
backend/
├── src/
│   ├── auth/           # Módulo de autenticação
│   │   ├── dto/         # Data Transfer Objects
│   │   ├── auth.controller.ts
│   │   ├── auth.service.ts
│   │   └── auth.module.ts
│   ├── entities/        # Entidades do TypeORM
│   │   └── user.entity.ts
│   ├── migrations/      # Migrations do banco de dados
│   ├── app.module.ts
│   └── main.ts
├── typeorm.config.ts    # Configuração do TypeORM
└── package.json
```

## Endpoints da API

### Autenticação

#### POST /auth/register
Cria uma nova conta de usuário.

**Body:**
```json
{
  "firstName": "João",
  "lastName": "Silva",
  "email": "joao@example.com",
  "password": "senha123"
}
```

**Response:**
```json
{
  "user": {
    "id": 1,
    "firstName": "João",
    "lastName": "Silva",
    "email": "joao@example.com",
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  },
  "token": "jwt-token-here"
}
```

#### POST /auth/login
Autentica um usuário existente.

**Body:**
```json
{
  "email": "joao@example.com",
  "password": "senha123"
}
```

**Response:**
```json
{
  "user": {
    "id": 1,
    "firstName": "João",
    "lastName": "Silva",
    "email": "joao@example.com",
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  },
  "token": "jwt-token-here"
}
```

## Tecnologias Utilizadas

- **NestJS** - Framework Node.js
- **TypeORM** - ORM para TypeScript
- **MySQL** - Banco de dados
- **JWT** - Autenticação
- **bcrypt** - Hash de senhas
- **class-validator** - Validação de dados
