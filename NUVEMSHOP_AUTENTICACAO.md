# 🔐 Autenticação na API da Nuvemshop

## ⚠️ IMPORTANTE: Diferenças da Nuvemshop

A Nuvemshop tem requisitos específicos de autenticação que **diferem** do padrão OAuth 2.0:

### 1. Cabeçalho de Autenticação

❌ **ERRADO (padrão OAuth 2.0):**
```
Authorization: Bearer {access_token}
```

✅ **CORRETO (Nuvemshop):**
```
Authentication: bearer {access_token}
```

**Diferenças:**
- Cabeçalho: `Authentication` (não `Authorization`)
- Tipo de token: `bearer` (minúsculo, não `Bearer`)

### 2. Cabeçalho User-Agent Obrigatório

A Nuvemshop exige que todas as requisições incluam o cabeçalho `User-Agent`:

```
User-Agent: Nucleo CRM (https://nucleocrm.com.br)
```

## 📝 Exemplo de Requisição Correta

```javascript
const response = await fetch(
  `https://api.nuvemshop.com.br/v1/${storeId}/products?limit=250`,
  {
    headers: {
      'Authentication': `bearer ${accessToken}`,
      'User-Agent': 'Nucleo CRM (https://nucleocrm.com.br)',
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
  }
);
```

## 🔍 Onde Isso Foi Aplicado

Todas as requisições à API da Nuvemshop no código foram atualizadas para usar:
- ✅ `Authentication: bearer {token}` em vez de `Authorization: Bearer {token}`
- ✅ `User-Agent` em todas as requisições

**Arquivos atualizados:**
- `backend/src/nuvemshop/nuvemshop.service.ts`
- `backend/src/nuvemshop/nuvemshop.controller.ts`

## ⚠️ Erro Comum

Se você receber `401 Unauthorized` com `Invalid access token`, verifique:

1. ✅ Está usando `Authentication` (não `Authorization`)?
2. ✅ Está usando `bearer` em minúsculo (não `Bearer`)?
3. ✅ Está incluindo o cabeçalho `User-Agent`?
4. ✅ O token tem os scopes necessários (ex: `read_products`)?

## 📚 Referências

- Documentação oficial da Nuvemshop sobre autenticação
- Solução para Erro 401 Unauthorized (documento fornecido pelo usuário)


