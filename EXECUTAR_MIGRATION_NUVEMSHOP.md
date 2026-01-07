# 🚀 Executar Migration da Tabela Nuvemshop

## ⚠️ Problema Identificado

A tabela `nuvemshop_connections` não existe no banco de dados, causando o erro:
```
Table 'nucleo_crm.nuvemshop_connections' doesn't exist
```

## ✅ Solução: Executar a Migration

### No Servidor de Produção (SSH):

```bash
# 1. Acessar o servidor via SSH
ssh usuario@seu-servidor

# 2. Ir para a pasta do projeto
cd /caminho/para/nucleo-crm/backend

# 3. Executar a migration
npm run migration:run
```

### Ou se estiver usando PM2:

```bash
# 1. Acessar o servidor
ssh usuario@seu-servidor

# 2. Ir para a pasta do backend
cd /caminho/para/nucleo-crm/backend

# 3. Executar a migration (o backend pode continuar rodando)
npm run migration:run

# 4. Reiniciar o backend se necessário
pm2 restart nucleo-backend
```

## 📋 O que a Migration Faz

A migration `1700000000016-CreateNuvemshopConnectionsTable.ts` cria a tabela:

```sql
CREATE TABLE nuvemshop_connections (
  id INT PRIMARY KEY AUTO_INCREMENT,
  userId INT NOT NULL,
  storeId VARCHAR(255) NOT NULL,
  accessToken TEXT NOT NULL,
  scope TEXT,
  isActive BOOLEAN DEFAULT TRUE,
  lastSyncAt DATETIME,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
);
```

## 🔍 Verificar se Funcionou

Após executar a migration, verifique:

```bash
# Ver status das migrations
npm run migration:show
```

Você deve ver a migration `CreateNuvemshopConnectionsTable1700000000016` na lista de migrations executadas.

## 🧪 Testar a Conexão

Após criar a tabela, tente conectar novamente com a Nuvemshop. O erro deve desaparecer.

## ⚡ Comando Rápido (Copiar e Colar)

```bash
cd /caminho/para/nucleo-crm/backend && npm run migration:run
```

**Nota:** Substitua `/caminho/para/nucleo-crm/backend` pelo caminho real do seu projeto no servidor.

