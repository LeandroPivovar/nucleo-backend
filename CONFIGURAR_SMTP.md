# Configuração SMTP - ULTRA Academy

## ⚠️ IMPORTANTE: Configure o arquivo `.env`

Crie ou edite o arquivo `.env` na raiz do diretório `backend/` com as seguintes variáveis:

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

## Passos para Configurar

1. **Navegue até a pasta backend:**
   ```bash
   cd backend
   ```

2. **Crie o arquivo `.env`** (se não existir):
   - No Windows: Crie um novo arquivo chamado `.env` na pasta `backend/`
   - No Linux/Mac: Use `touch .env`

3. **Cole o conteúdo acima** no arquivo `.env`

4. **IMPORTANTE - Senha de App do Gmail:**
   - A senha `zgri migf nurw hmqy` deve ser uma **Senha de App** do Gmail
   - Se não funcionar, gere uma nova:
     1. Acesse: https://myaccount.google.com/apppasswords
     2. Selecione "App" → "Outro (nome personalizado)"
     3. Digite "Núcleo CRM"
     4. Clique em "Gerar"
     5. Copie a senha de 16 caracteres (sem espaços)
     6. Use no `SMTP_PASSWORD`

5. **Reinicie o backend** após configurar:
   ```bash
   npm run start:dev
   ```

## Verificar se está funcionando

Após configurar, tente usar a recuperação de senha novamente. Se ainda houver erro, verifique:

1. Os logs do backend para mensagens de erro mais específicas
2. Se o arquivo `.env` está na pasta correta (`backend/.env`)
3. Se não há espaços extras nas variáveis
4. Se a senha de app está correta (16 caracteres, sem espaços)

## Nota sobre a Senha

A senha `zgri migf nurw hmqy` tem espaços. Se não funcionar, remova os espaços ou gere uma nova senha de app sem espaços.

