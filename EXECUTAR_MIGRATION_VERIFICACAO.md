# ⚠️ IMPORTANTE: Execute a Migration de Verificação de E-mail

O sistema de verificação de e-mail requer que você execute a migration que adiciona:
- Campo `active` na tabela `users`
- Tabela `email_verifications`

## Como Executar

```bash
cd backend
npm run migration:run
```

Isso executará a migration `1700000000005-AddActiveToUsersAndCreateEmailVerifications.ts`.

## Verificar se Funcionou

Após executar a migration, verifique se:
1. A tabela `email_verifications` foi criada
2. A coluna `active` foi adicionada na tabela `users`

Você pode verificar executando:
```bash
npm run migration:show
```

## Se Der Erro

Se a migration falhar, verifique:
1. Se o banco de dados está rodando
2. Se as credenciais no `.env` estão corretas
3. Se a tabela `users` já existe

## Após Executar

Reinicie o backend:
```bash
npm run start:dev
```

Agora o registro de contas deve funcionar corretamente!

