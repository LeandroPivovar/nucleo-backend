# Troubleshooting - Integração Shopify

## Problema: Endpoint `/api/shopify/auth/init` retorna 404

### Possíveis Causas e Soluções

#### 1. Arquivos não foram compilados no servidor

**Sintoma:** O módulo Shopify não aparece nos logs de inicialização.

**Solução:**
```bash
cd backend
npm run build
pm2 restart nucleo-backend
```

#### 2. Migration não foi executada

**Sintoma:** Erro ao inicializar o módulo porque a tabela `shopify_connections` não existe.

**Solução:**
```bash
cd backend
npm run migration:run
pm2 restart nucleo-backend
```

#### 3. Erro de compilação silencioso

**Sintoma:** O build parece ter sucesso, mas o módulo não é carregado.

**Solução:**
```bash
cd backend
# Limpar dist
rm -rf dist
# Rebuild completo
npm run build
# Verificar se há erros
cat dist/shopify/shopify.module.js
# Reiniciar
pm2 restart nucleo-backend
```

#### 4. Verificar se o módulo está sendo importado

**Verificação:**
```bash
# Verificar se o arquivo compilado existe
ls -la dist/shopify/
# Deve mostrar:
# - shopify.controller.js
# - shopify.module.js
# - shopify.service.js
# - dto/
```

#### 5. Verificar logs de erro

**Verificação:**
```bash
# Ver logs de erro do PM2
pm2 logs nucleo-backend --err --lines 50

# Ou verificar se há erros de inicialização
pm2 logs nucleo-backend --lines 100 | grep -i error
```

#### 6. Verificar se a entidade está registrada

**Verificação no código:**
- `backend/src/app.module.ts` deve importar `ShopifyConnection` e `ShopifyModule`
- `backend/src/app.module.ts` deve incluir `ShopifyConnection` no array `entities`

#### 7. Verificar variáveis de ambiente

**Verificação:**
```bash
# Verificar se as variáveis estão configuradas
cat .env | grep SHOPIFY
# Deve mostrar:
# SHOPIFY_CLIENT_ID=...
# SHOPIFY_CLIENT_SECRET=...
```

## Checklist de Verificação

- [ ] Migration executada: `npm run migration:run`
- [ ] Build executado: `npm run build`
- [ ] Arquivos compilados existem em `dist/shopify/`
- [ ] PM2 reiniciado: `pm2 restart nucleo-backend`
- [ ] Logs verificados para erros
- [ ] Variáveis de ambiente configuradas no `.env`
- [ ] Tabela `shopify_connections` existe no banco de dados

## Comandos de Diagnóstico Rápido

```bash
# 1. Verificar se os arquivos existem
ls -la backend/src/shopify/

# 2. Verificar se foram compilados
ls -la backend/dist/shopify/

# 3. Verificar se a migration foi executada
mysql -u root -p nucleo_crm -e "SHOW TABLES LIKE 'shopify_connections';"

# 4. Rebuild completo
cd backend
rm -rf dist
npm run build
npm run migration:run
pm2 restart nucleo-backend

# 5. Ver logs
pm2 logs nucleo-backend --lines 50
```

## Se nada funcionar

1. **Verificar se há erros de sintaxe:**
   ```bash
   cd backend
   npm run build 2>&1 | grep -i error
   ```

2. **Verificar se o TypeScript compila:**
   ```bash
   cd backend
   npx tsc --noEmit
   ```

3. **Verificar se o módulo está sendo importado corretamente:**
   ```bash
   grep -r "ShopifyModule" backend/src/app.module.ts
   ```

4. **Verificar logs do PM2 em tempo real:**
   ```bash
   pm2 logs nucleo-backend --lines 0
   # Depois reinicie e veja o que aparece
   ```


