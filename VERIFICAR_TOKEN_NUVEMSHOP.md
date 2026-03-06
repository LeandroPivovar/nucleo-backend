# 🔍 Verificar e Corrigir Token Nuvemshop Inválido

## Problema Identificado

O erro "Invalid access token" indica que o token salvo não está válido. Isso pode acontecer por:

1. Token não foi salvo corretamente durante a conexão
2. Token foi corrompido durante criptografia/descriptografia
3. Token precisa ser reobtido

## ✅ Solução: Reconectar a Integração

A melhor solução é **reconectar a integração Nuvemshop** para obter um novo token válido.

### Passos:

1. **Acesse a página de Integrações** no sistema
2. **Desconecte a integração Nuvemshop** (se estiver conectada)
3. **Conecte novamente** seguindo o fluxo OAuth
4. **Autorize novamente** na Nuvemshop
5. O novo token será salvo automaticamente

## 🔧 Verificação Técnica

### Verificar se o token está salvo no banco:

```sql
SELECT 
  id,
  userId,
  storeId,
  LENGTH(accessToken) as token_length,
  scope,
  isActive,
  createdAt,
  updatedAt
FROM nuvemshop_connections
WHERE storeId = '7138199';
```

### Testar o token via API:

```bash
curl -X POST https://nucleocrm.com.br/api/nuvemshop/test-connection \
  -H "Authorization: Bearer {seu_token_jwt}" \
  -H "Content-Type: application/json" \
  -d '{"storeId": "7138199"}'
```

## ⚠️ Possíveis Causas

1. **Token não foi salvo**: O callback pode ter falhado ao salvar
2. **Token corrompido**: Problema na criptografia/descriptografia
3. **Token expirado**: Embora a Nuvemshop diga que tokens não expiram, pode haver casos especiais
4. **Token revogado**: O usuário pode ter revogado o acesso no painel da Nuvemshop

## 🚀 Próximos Passos

1. Reconecte a integração para obter um novo token
2. Teste a sincronização novamente
3. Se o problema persistir, verifique os logs do backend


