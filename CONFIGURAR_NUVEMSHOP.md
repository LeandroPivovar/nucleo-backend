# Configuração da Integração Nuvemshop

## 📋 Pré-requisitos

- App ID: `24731`
- Client Secret: `bff8303f400b05b63945f07dc77de74e142e890eba84face`

## 🔧 Configuração no Backend

### 1. Adicionar Variáveis de Ambiente

Adicione as seguintes variáveis ao arquivo `.env` na pasta `backend/`:

```env
# Nuvemshop OAuth
NUVEMSHOP_CLIENT_ID=24731
NUVEMSHOP_CLIENT_SECRET=bff8303f400b05b63945f07dc77de74e142e890eba84face

# URL do Backend (ajuste conforme seu ambiente)
BACKEND_URL=http://localhost:3000
# OU em produção:
# BACKEND_URL=https://api.seudominio.com
```

### 2. Criar Migration para a Tabela

Execute a migration para criar a tabela `nuvemshop_connections`:

```bash
cd backend
npm run migration:generate -- src/migrations/CreateNuvemshopConnectionsTable
npm run migration:run
```

## 🔗 URL de Redirecionamento (Redirect URI)

**Configure esta URL no painel de desenvolvedor da Nuvemshop:**

### Desenvolvimento (Local):
```
http://localhost:3000/api/nuvemshop/auth/callback
```

### Produção:
```
https://api.seudominio.com/api/nuvemshop/auth/callback
```
*(Substitua `api.seudominio.com` pela URL real do seu backend em produção)*

## 📝 Como Configurar no Painel da Nuvemshop

1. Acesse o [Painel de Desenvolvedor da Nuvemshop](https://partners.nuvemshop.com.br/)
2. Vá em **Meus Apps** → Selecione seu app (ID: 24731)
3. Encontre a seção **Redirect URI** ou **URL de Redirecionamento**
4. Cole a URL de redirecionamento acima (use a de produção se já estiver em produção)
5. Salve as alterações

## 🚀 Fluxo de Integração

### 1. Iniciar Autorização

O frontend deve chamar:
```
POST /api/nuvemshop/auth/init
Headers: Authorization: Bearer {token_jwt}
```

Resposta:
```json
{
  "authUrl": "https://www.nuvemshop.com.br/apps/24731/authorize?state={csrf_token}",
  "state": "{csrf_token}"
}
```

### 2. Redirecionar o Usuário

Redirecione o usuário para a `authUrl` retornada. O usuário autorizará a aplicação na Nuvemshop.

### 3. Callback Automático

Após a autorização, a Nuvemshop redirecionará automaticamente para:
```
GET /api/nuvemshop/auth/callback?code={authorization_code}&state={csrf_token}
```

Este endpoint troca o código por um token de acesso e retorna:
```json
{
  "success": true,
  "access_token": "...",
  "user_id": "789",
  "scope": "read_orders,write_products",
  "state": "{csrf_token}"
}
```

### 4. Salvar Conexão

O frontend deve chamar para salvar a conexão:
```
POST /api/nuvemshop/auth/connect
Headers: Authorization: Bearer {token_jwt}
Body: {
  "storeId": "789",
  "accessToken": "...",
  "scope": "read_orders,write_products"
}
```

## 📚 Endpoints Disponíveis

### Conexões
- `GET /api/nuvemshop/connections` - Lista conexões do usuário
- `POST /api/nuvemshop/disconnect` - Desconecta uma loja

### Produtos
- `POST /api/nuvemshop/products/sync` - Sincroniza um produto

### Carrinhos Abandonados
- `GET /api/nuvemshop/checkouts/abandoned?storeId={id}` - Lista carrinhos abandonados

### Webhooks
- `POST /api/nuvemshop/webhooks` - Cria um webhook
- `GET /api/nuvemshop/webhooks?storeId={id}` - Lista webhooks
- `POST /api/nuvemshop/webhooks/receive` - Recebe webhooks da Nuvemshop

## ⚠️ Importante

1. **Segurança**: O endpoint `/api/nuvemshop/auth/callback` é público (sem autenticação JWT) pois é chamado pela Nuvemshop. A segurança é garantida pela verificação do `state` (CSRF token).

2. **Tokens**: Os tokens de acesso são criptografados antes de serem salvos no banco de dados.

3. **Webhooks**: O endpoint de webhooks verifica a assinatura HMAC usando o `Client Secret` para garantir autenticidade.

4. **Scopes**: Os scopes solicitados são:
   - `read_products, write_products` - Para sincronização de produtos
   - `read_orders, write_orders` - Para receber pedidos
   - `read_checkouts, write_checkouts` - Para carrinhos abandonados

## 🔍 Troubleshooting

### Erro: "Código de autorização não fornecido"
- Verifique se a URL de redirecionamento está configurada corretamente no painel da Nuvemshop
- Certifique-se de que a URL corresponde exatamente (incluindo http/https, porta, etc.)

### Erro: "Falha ao obter token de acesso"
- Verifique se o `Client ID` e `Client Secret` estão corretos no `.env`
- O código de autorização expira em 5 minutos - certifique-se de trocá-lo rapidamente

### Erro: "Assinatura inválida" (webhooks)
- Verifique se o `NUVEMSHOP_CLIENT_SECRET` está correto
- Certifique-se de que o `rawBody` está habilitado no `main.ts` (já está configurado)

