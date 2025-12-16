# Configuração de Variáveis de Ambiente

## ⚠️ IMPORTANTE: Crie o arquivo `.env` na raiz do backend

Crie um arquivo chamado `.env` (sem extensão) na pasta `backend/` com o seguinte conteúdo:

```env
# Database
DB_HOST=localhost
DB_PORT=3306
DB_USERNAME=root
DB_PASSWORD=
DB_DATABASE=nucleo_crm

# JWT
JWT_SECRET=your-secret-key-change-in-production

# SMTP Configuration - ULTRA Academy
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=tls
SMTP_USERNAME=suporte.ultra.academy@gmail.com
SMTP_PASSWORD=zgri migf nurw hmqy
SMTP_FROM_EMAIL=suporte.ultra.academy@gmail.com
SMTP_FROM_NAME=ULTRA Academy

# Frontend URL
FRONTEND_URL=http://localhost:8080
```

## Como criar o arquivo `.env`

### Windows:
1. Abra o Explorador de Arquivos
2. Navegue até `backend/`
3. Clique com botão direito → Novo → Documento de Texto
4. Renomeie para `.env` (incluindo o ponto no início)
5. Se o Windows avisar sobre mudar a extensão, confirme
6. Abra o arquivo e cole o conteúdo acima

### Linux/Mac:
```bash
cd backend
nano .env
# Cole o conteúdo e salve (Ctrl+X, Y, Enter)
```

## ⚠️ IMPORTANTE sobre a senha SMTP

A senha `zgri migf nurw hmqy` **deve ser uma Senha de App do Gmail**, não a senha normal da conta.

Se não funcionar:
1. Acesse: https://myaccount.google.com/apppasswords
2. Gere uma nova senha de app
3. Use a senha gerada (16 caracteres, sem espaços) no `SMTP_PASSWORD`

## Após configurar

1. **Reinicie o backend:**
   ```bash
   cd backend
   npm run start:dev
   ```

2. **Verifique os logs** - não deve aparecer mais o erro de credenciais não configuradas

## Notas sobre SMTP:

- **SMTP_SECURE**: Pode ser `tls`, `ssl`, `true` ou `false`
  - `tls` ou `false`: Usa STARTTLS (porta 587)
  - `ssl` ou `true`: Usa SSL direto (porta 465)
  
- **SMTP_USERNAME** e **SMTP_PASSWORD**: Alternativamente, você pode usar `SMTP_USER` e `SMTP_PASS`

- **SMTP_FROM**: Você pode usar:
  - `SMTP_FROM="Nome <email@exemplo.com>"` (formato completo)
  - OU `SMTP_FROM_NAME` + `SMTP_FROM_EMAIL` (será combinado automaticamente)

