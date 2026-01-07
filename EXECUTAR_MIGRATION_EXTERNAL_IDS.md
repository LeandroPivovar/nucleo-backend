# 🔧 Executar Migration para Adicionar Campo externalIds

## ⚠️ Erro Atual

O erro indica que a coluna `externalIds` não existe na tabela `products`:

```
Unknown column 'Product.externalIds' in 'field list'
```

## ✅ Solução: Executar a Migration

A migration já foi criada, mas precisa ser executada no servidor.

### Passo 1: Acessar o Servidor

```bash
ssh seu-usuario@seu-servidor
cd /caminho/para/backend
```

### Passo 2: Executar a Migration

```bash
npm run migration:run
```

### Passo 3: Verificar se Funcionou

A migration deve adicionar a coluna `externalIds` do tipo JSON na tabela `products`.

Você pode verificar executando:

```sql
DESCRIBE products;
```

Ou:

```sql
SHOW COLUMNS FROM products LIKE 'externalIds';
```

## 📝 O que a Migration Faz

A migration `1767794188805-src_migrations_AddExternalIdsToProducts.ts` adiciona:

- **Coluna**: `externalIds` 
- **Tipo**: `JSON`
- **Nullable**: `true` (permite NULL)

Esta coluna armazena os IDs externos dos produtos nas integrações:

```json
{
  "nuvemshop": {
    "7138199": 123456
  },
  "shopify": {
    "loja.myshopify.com": "gid://shopify/Product/789012"
  }
}
```

## 🔄 Após Executar a Migration

Após executar a migration, o sistema poderá:

1. ✅ Salvar IDs externos quando produtos são sincronizados
2. ✅ Atualizar produtos existentes em vez de criar duplicatas
3. ✅ Buscar produtos por SKU para evitar duplicatas

## ⚠️ Importante

- A migration é **segura** e não afeta dados existentes
- Produtos existentes terão `externalIds = NULL` até serem sincronizados
- A coluna é opcional (nullable), então não quebra produtos existentes


