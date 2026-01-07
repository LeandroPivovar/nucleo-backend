# 🔧 Como Configurar Scopes no Painel da Nuvemshop

## ⚠️ Problema Identificado

O token está sendo gerado apenas com o escopo `write_products`, mas para buscar produtos da API é necessário o escopo `read_products`.

**Erro atual:**
```
Invalid access token
```

**Causa:** O app na Nuvemshop não está configurado com o escopo `read_products`.

## ✅ Solução: Configurar Scopes no Painel da Nuvemshop

### Passo 1: Acessar o Painel de Desenvolvedor

1. Acesse: https://partners.nuvemshop.com.br/
2. Faça login com sua conta
3. Vá em **Meus Apps** ou **Aplicativos**

### Passo 2: Selecionar o App

1. Encontre o app com **App ID: 24731**
2. Clique para editar o app

### Passo 3: Configurar Scopes (Permissões)

1. Procure pela seção **Scopes**, **Permissões** ou **OAuth Scopes**
2. Certifique-se de que os seguintes scopes estão **marcados/ativados**:

   ✅ **read_products** - Ler produtos (OBRIGATÓRIO para buscar produtos)
   ✅ **write_products** - Criar/atualizar produtos
   ✅ **read_orders** - Ler pedidos
   ✅ **write_orders** - Criar/atualizar pedidos
   ✅ **read_checkouts** - Ler carrinhos abandonados
   ✅ **write_checkouts** - Criar/atualizar carrinhos

3. **Salve as alterações**

### Passo 4: Reconectar a Integração

⚠️ **IMPORTANTE:** Após alterar os scopes, você **DEVE** reconectar a integração para obter um novo token com os scopes corretos.

1. No sistema Nucleo CRM, vá em **Integrações**
2. **Desconecte** a integração Nuvemshop atual
3. **Conecte novamente** seguindo o fluxo OAuth
4. **Autorize** novamente na Nuvemshop
5. O novo token terá os scopes corretos

## 🔍 Como Verificar se os Scopes Estão Corretos

Após reconectar, verifique os logs do backend. Você deve ver:

```
Token obtido com sucesso: {
  scope: 'read_products,write_products,read_orders,write_orders,read_checkouts,write_checkouts'
}
```

Se ainda aparecer apenas `write_products`, os scopes não foram configurados corretamente no painel.

## 📝 Nota Importante

- A Nuvemshop **não permite** passar scopes na URL de autorização
- Os scopes são configurados **apenas** no painel do desenvolvedor
- Cada vez que você alterar os scopes no painel, **deve reconectar** todas as integrações para obter novos tokens

## 🆘 Se o Problema Persistir

1. Verifique se salvou as alterações no painel da Nuvemshop
2. Aguarde alguns minutos (pode haver cache)
3. Desconecte e reconecte a integração
4. Verifique os logs do backend para confirmar os scopes recebidos
5. Entre em contato com o suporte da Nuvemshop se necessário

