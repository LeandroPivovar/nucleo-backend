# Troubleshooting - Erro ao Enviar E-mail

## Erro: "Erro ao enviar e-mail. Tente novamente mais tarde."

Este erro geralmente ocorre quando há problemas com a configuração SMTP. Siga os passos abaixo para resolver:

## 1. Verificar Configuração no arquivo `.env`

Certifique-se de que o arquivo `.env` na raiz do backend contém todas as variáveis necessárias:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=tls
SMTP_USERNAME=suporte.ultra.academy@gmail.com
SMTP_PASSWORD=zgri migf nurw hmqy
SMTP_FROM_EMAIL=suporte.ultra.academy@gmail.com
SMTP_FROM_NAME=ULTRA Academy
```

## 2. Verificar se o arquivo `.env` está sendo lido

- O arquivo `.env` deve estar na raiz do diretório `backend/`
- Reinicie o servidor após alterar o `.env`
- Verifique se não há espaços extras nas variáveis

## 3. Problemas Comuns e Soluções

### Erro: "Credenciais SMTP inválidas"
- **Causa**: Usuário ou senha incorretos
- **Solução**: 
  - Para Gmail, você DEVE usar uma "Senha de App", não a senha normal
  - Gere uma nova senha de app em: https://myaccount.google.com/apppasswords
  - Use a senha de app gerada no `SMTP_PASSWORD`

### Erro: "Não foi possível conectar ao servidor SMTP"
- **Causa**: Host ou porta incorretos, ou firewall bloqueando
- **Solução**:
  - Verifique se `SMTP_HOST` está correto (smtp.gmail.com para Gmail)
  - Verifique se `SMTP_PORT` está correto (587 para TLS, 465 para SSL)
  - Verifique se não há firewall bloqueando a conexão

### Erro: "Falha na autenticação SMTP"
- **Causa**: Credenciais incorretas ou conta com verificação em duas etapas
- **Solução**:
  - Ative a verificação em duas etapas no Gmail
  - Gere uma senha de app específica
  - Use a senha de app no `SMTP_PASSWORD`

## 4. Testar Configuração SMTP

Você pode testar a conexão SMTP criando um endpoint de teste ou verificando os logs do servidor.

## 5. Verificar Logs do Backend

Os logs do backend mostrarão mensagens mais detalhadas sobre o erro. Procure por:
- "Erro ao enviar e-mail: ..."
- Verifique a mensagem de erro completa para identificar o problema específico

## 6. Configuração Gmail Específica

Para Gmail, você precisa:

1. **Ativar verificação em duas etapas**:
   - Acesse: https://myaccount.google.com/security
   - Ative "Verificação em duas etapas"

2. **Gerar Senha de App**:
   - Acesse: https://myaccount.google.com/apppasswords
   - Selecione "App" e "Outro (nome personalizado)"
   - Digite "Núcleo CRM" como nome
   - Clique em "Gerar"
   - Copie a senha gerada (16 caracteres sem espaços)
   - Use essa senha no `SMTP_PASSWORD`

3. **Configuração no `.env`**:
   ```env
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_SECURE=tls
   SMTP_USERNAME=seu-email@gmail.com
   SMTP_PASSWORD=senha-de-app-gerada
   ```

## 7. Verificar se o Backend está rodando

Certifique-se de que o backend está rodando e que as variáveis de ambiente foram carregadas:

```bash
cd backend
npm run start:dev
```

## 8. Testar Manualmente

Você pode testar o envio de e-mail usando o método `verifyConnection()` do EmailService ou criando um endpoint de teste temporário.

## Ainda com problemas?

1. Verifique os logs completos do backend
2. Teste as credenciais em um cliente de e-mail externo (como Outlook ou Thunderbird)
3. Verifique se o Gmail não bloqueou o acesso de apps menos seguros (isso não se aplica mais, mas verifique se a conta está ativa)

