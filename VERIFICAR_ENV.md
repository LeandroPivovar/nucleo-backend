# Como Verificar se o .env está Configurado

## Passo 1: Verificar se o arquivo .env existe

Execute no terminal (na pasta backend):

```bash
cd backend
dir .env
```

Ou no Linux/Mac:
```bash
ls -la .env
```

Se o arquivo não existir, crie-o:
```bash
npm run env:create
```

## Passo 2: Verificar o conteúdo do arquivo .env

Abra o arquivo `backend/.env` e verifique se contém:

```env
SMTP_USERNAME=suporte.ultra.academy@gmail.com
SMTP_PASSWORD=zgri migf nurw hmqy
```

**IMPORTANTE:**
- Não deve haver espaços antes ou depois do `=`
- Não deve haver aspas ao redor dos valores
- Cada variável deve estar em uma linha separada

## Passo 3: Testar se as variáveis estão sendo lidas

Execute o script de teste:

```bash
cd backend
npm run test:smtp
```

Isso mostrará quais variáveis estão configuradas e quais estão faltando.

## Passo 4: Reiniciar o backend

**CRÍTICO:** Após criar ou modificar o arquivo `.env`, você DEVE reiniciar o backend:

```bash
# Pare o servidor (Ctrl+C)
# Depois inicie novamente:
npm run start:dev
```

## Problemas Comuns

### Erro: "Credenciais SMTP não configuradas"

**Causas possíveis:**
1. Arquivo `.env` não existe na pasta `backend/`
2. Arquivo `.env` não contém `SMTP_USERNAME` e `SMTP_PASSWORD`
3. Backend não foi reiniciado após criar/modificar o `.env`
4. Espaços extras ou formatação incorreta no `.env`

**Solução:**
1. Execute `npm run env:create` para criar o arquivo
2. Verifique o conteúdo do arquivo
3. Reinicie o backend completamente

### O arquivo .env existe mas ainda dá erro

1. Verifique se está na pasta correta: `backend/.env` (não `backend/backend/.env`)
2. Verifique se não há espaços extras: `SMTP_USERNAME=valor` (não `SMTP_USERNAME = valor`)
3. Verifique se não há aspas: `SMTP_PASSWORD=senha` (não `SMTP_PASSWORD="senha"`)
4. Reinicie o backend

## Verificar Logs do Backend

Ao iniciar o backend, você deve ver nos logs:
- `✅ Credenciais SMTP carregadas com sucesso` (se configurado corretamente)
- `⚠️ Credenciais SMTP não encontradas!` (se não configurado)

