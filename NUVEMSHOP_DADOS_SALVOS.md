# Dados Salvos da Conexão Nuvemshop

## 📋 Informações da Conexão Atual

Com base na autorização realizada, os seguintes dados foram salvos:

### Dados Obtidos da Autorização:
- **Access Token**: `ee6411520363fd2fa6fa5924db1db41d1cbca57c`
- **User ID (Store ID)**: `7138199`
- **Scope**: `write_products`
- **State (CSRF Token)**: `241002ca95bbb3d63dc8c77544a81ccd873f5ac644b7e64cdf6f84f211cc5561`

## 💾 Como os Dados São Armazenados

### 1. **No Banco de Dados**

Os dados são salvos na tabela `nuvemshop_connections` com a seguinte estrutura:

```sql
CREATE TABLE nuvemshop_connections (
  id INT PRIMARY KEY AUTO_INCREMENT,
  userId INT NOT NULL,
  storeId VARCHAR(255) NOT NULL,  -- 7138199
  accessToken TEXT NOT NULL,       -- Criptografado
  scope TEXT,                       -- write_products
  isActive BOOLEAN DEFAULT TRUE,
  lastSyncAt DATETIME,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
);
```

### 2. **Criptografia do Token**

O `access_token` é **criptografado** antes de ser salvo no banco usando:
- Algoritmo: AES-256-CBC
- Chave: Derivada do `NUVEMSHOP_CLIENT_SECRET` usando SHA-256
- Formato: `{IV}:{encrypted_token}`

### 3. **Segurança**

- ✅ Tokens são criptografados antes de salvar
- ✅ Apenas o usuário que criou a conexão pode acessá-la
- ✅ Tokens não são expostos em logs ou respostas da API
- ✅ Verificação de CSRF token (state) para prevenir ataques

## 🔧 Como Usar os Dados Salvos

### Para Fazer Requisições à API da Nuvemshop:

```typescript
// 1. Obter o token descriptografado
const accessToken = await nuvemshopService.getAccessToken(userId, storeId);

// 2. Fazer requisição à API
const response = await fetch(
  `https://api.nuvemshop.com.br/v1/${storeId}/products`,
  {
    headers: {
      'Authorization': `bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  }
);
```

### Endpoints Disponíveis:

1. **Sincronizar Produto**
   ```
   POST /api/nuvemshop/products/sync
   Body: { storeId: "7138199", ...productData }
   ```

2. **Buscar Carrinhos Abandonados**
   ```
   GET /api/nuvemshop/checkouts/abandoned?storeId=7138199
   ```

3. **Criar Webhook**
   ```
   POST /api/nuvemshop/webhooks
   Body: { storeId: "7138199", event: "order/created", url: "..." }
   ```

4. **Listar Conexões**
   ```
   GET /api/nuvemshop/connections
   ```

## 📝 Notas Importantes

1. **Token Permanente**: O token de acesso da Nuvemshop **não expira** a menos que:
   - Você obtenha um novo token
   - O usuário desinstale o aplicativo
   - Você revogue manualmente o acesso

2. **Store ID**: O `user_id` retornado pela Nuvemshop (7138199) é o **ID da loja** e deve ser usado em todas as requisições à API.

3. **Scopes**: O scope atual é `write_products`. Para usar outros recursos, você precisará:
   - Atualizar os scopes solicitados no `nuvemshop.service.ts`
   - Fazer uma nova autorização

4. **Múltiplas Lojas**: Cada usuário pode conectar múltiplas lojas. Cada conexão é armazenada separadamente.

## 🔍 Verificar Conexão no Banco

```sql
SELECT 
  id,
  userId,
  storeId,
  scope,
  isActive,
  lastSyncAt,
  createdAt
FROM nuvemshop_connections
WHERE storeId = '7138199';
```

**Nota**: O `accessToken` não é mostrado na consulta por segurança. Use a API para obter o token descriptografado quando necessário.

## 🚀 Próximos Passos

1. ✅ Conexão estabelecida
2. ⏭️ Sincronizar produtos
3. ⏭️ Configurar webhooks para pedidos
4. ⏭️ Buscar carrinhos abandonados
5. ⏭️ Implementar automações

