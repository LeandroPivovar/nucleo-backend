# 🔧 Resolver Duplicação de Produtos

## ⚠️ Problemas Identificados

1. **Campo `externalIds` não existe no banco** - Migration não executada
2. **Produtos sendo criados em vez de atualizados** - Sistema não encontra produtos existentes
3. **Erro "Unprocessable Entity"** - Dados inválidos ao tentar atualizar

## ✅ Soluções Aplicadas

### 1. Melhor Tratamento de Erros
- Logs detalhados para identificar problemas
- Tratamento quando campo `externalIds` não existe
- Mensagens de erro mais claras da API da Nuvemshop

### 2. Busca Melhorada por SKU
- Logs de debug para rastrear busca
- Busca automática por SKU quando ID não está salvo
- Logs quando produto é encontrado ou não encontrado

### 3. Logs Detalhados
- Mostra se está criando (POST) ou atualizando (PUT)
- Mostra ID encontrado ou se é novo
- Rastreia todo o fluxo de sincronização

## 🚀 Passos para Resolver

### Passo 1: Executar Migration (OBRIGATÓRIO)

```bash
cd /var/www/nucleo/backend
npm run migration:run
```

Ou execute o SQL manualmente:

```sql
ALTER TABLE `products` 
ADD COLUMN `externalIds` JSON NULL 
AFTER `active`;
```

### Passo 2: Verificar Logs

Após executar a migration e fazer deploy, os logs mostrarão:

```
Sincronizando produto X com Nuvemshop. ID existente: não encontrado, SKU: ABC123
Buscando produto por SKU: ABC123
Total de produtos encontrados na Nuvemshop: 10
Produto encontrado na Nuvemshop por SKU: ABC123 -> Product ID: 316746883
Enviando produto para Nuvemshop: PUT (atualizar), ID: 316746883
Produto X atualizado na Nuvemshop (storeId: 7138199, productId: 316746883)
```

### Passo 3: Testar

1. Edite um produto que já foi sincronizado
2. Verifique os logs - deve mostrar "atualizado" em vez de "criado"
3. Verifique na loja Nuvemshop - não deve criar duplicata

## 🔍 Como Funciona Agora

### Primeira Sincronização (Produto Novo)
1. Produto não tem ID externo salvo
2. Busca por SKU na loja
3. Se não encontrar → Cria novo produto
4. Salva o ID retornado

### Segunda Sincronização (Produto Existente)
1. Produto tem ID externo salvo → Usa para atualizar
2. Se não tem ID mas tem SKU → Busca por SKU
3. Se encontrar → Atualiza produto existente
4. Salva o ID se ainda não estava salvo

## ⚠️ Importante

- **SKU é obrigatório** para evitar duplicatas quando o ID não está salvo
- Se o produto não tem SKU, pode criar duplicatas
- Execute a migration antes de usar a sincronização automática

## 📝 Próximos Passos

1. ✅ Executar migration
2. ✅ Fazer deploy das alterações
3. ✅ Testar edição de produto existente
4. ✅ Verificar logs para confirmar que está atualizando

