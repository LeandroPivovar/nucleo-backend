import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { ShopifyService } from './shopify.service';
import { ShopifyConnection } from '../entities/shopify-connection.entity';
import { Contact } from '../entities/contact.entity';
import { Sale } from '../entities/sale.entity';
import { Product } from '../entities/product.entity';
import { User } from '../entities/user.entity';
import { Plan } from '../entities/plan.entity';
import { Subscription } from '../entities/subscription.entity';
import { ShopifyWebhookEvent } from '../entities/shopify-webhook-event.entity';
import { ShopifyDataRequest } from '../entities/shopify-data-request.entity';
import { WebhookLog } from '../entities/webhook-log.entity';
import { ContactPurchase } from '../entities/contact-purchase.entity';
import { CampaignMessageEvent } from '../entities/campaign-message-event.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { lookup } from 'dns/promises';

jest.mock('dns/promises', () => ({ lookup: jest.fn() }));

const mockRepository = () => ({
  find: jest.fn().mockResolvedValue([]),
  findOne: jest.fn(),
  save: jest.fn((v) => Promise.resolve({ id: 1, ...v })),
  create: jest.fn((v) => v),
  insert: jest.fn(),
  update: jest.fn().mockResolvedValue({ affected: 0 }),
  delete: jest.fn().mockResolvedValue({ affected: 0 }),
  createQueryBuilder: jest.fn(() => ({
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([]),
    getOne: jest.fn().mockResolvedValue(null),
    execute: jest.fn().mockResolvedValue({ affected: 0 }),
  })),
});

describe('ShopifyService — webhooks de pedido e rate limit', () => {
  let service: ShopifyService;
  let webhookEventRepo: ReturnType<typeof mockRepository>;
  let saleRepo: ReturnType<typeof mockRepository>;
  let contactRepo: ReturnType<typeof mockRepository>;
  let productRepo: ReturnType<typeof mockRepository>;
  let connectionRepo: ReturnType<typeof mockRepository>;
  let dataRequestRepo: ReturnType<typeof mockRepository>;
  let contactPurchaseRepo: ReturnType<typeof mockRepository>;
  let messageEventRepo: ReturnType<typeof mockRepository>;
  let userRepo: ReturnType<typeof mockRepository>;
  let subscriptionRepo: ReturnType<typeof mockRepository>;
  let notifications: { create: jest.Mock };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShopifyService,
        { provide: getRepositoryToken(ShopifyConnection), useFactory: mockRepository },
        { provide: getRepositoryToken(Contact), useFactory: mockRepository },
        { provide: getRepositoryToken(Sale), useFactory: mockRepository },
        { provide: getRepositoryToken(Product), useFactory: mockRepository },
        { provide: getRepositoryToken(User), useFactory: mockRepository },
        { provide: getRepositoryToken(Plan), useFactory: mockRepository },
        { provide: getRepositoryToken(Subscription), useFactory: mockRepository },
        { provide: getRepositoryToken(ShopifyWebhookEvent), useFactory: mockRepository },
        { provide: getRepositoryToken(ShopifyDataRequest), useFactory: mockRepository },
        { provide: getRepositoryToken(WebhookLog), useFactory: mockRepository },
        { provide: getRepositoryToken(ContactPurchase), useFactory: mockRepository },
        { provide: getRepositoryToken(CampaignMessageEvent), useFactory: mockRepository },
        { provide: NotificationsService, useValue: { create: jest.fn().mockResolvedValue({}) } },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((k: string) => {
              if (k === 'SHOPIFY_CLIENT_ID') return 'client-id';
              if (k === 'SHOPIFY_CLIENT_SECRET') return 'secret';
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    service = module.get(ShopifyService);
    webhookEventRepo = module.get(getRepositoryToken(ShopifyWebhookEvent));
    saleRepo = module.get(getRepositoryToken(Sale));
    contactRepo = module.get(getRepositoryToken(Contact));
    productRepo = module.get(getRepositoryToken(Product));
    connectionRepo = module.get(getRepositoryToken(ShopifyConnection));
    dataRequestRepo = module.get(getRepositoryToken(ShopifyDataRequest));
    contactPurchaseRepo = module.get(getRepositoryToken(ContactPurchase));
    messageEventRepo = module.get(getRepositoryToken(CampaignMessageEvent));
    userRepo = module.get(getRepositoryToken(User));
    subscriptionRepo = module.get(getRepositoryToken(Subscription));
    notifications = module.get(NotificationsService);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('resolveShopDomain', () => {
    it('normaliza URL de domínio permanente sem consultar a vitrine', async () => {
      await expect(service.resolveShopDomain('https://LOJA.myshopify.com/admin'))
        .resolves.toBe('loja.myshopify.com');
      expect(lookup).not.toHaveBeenCalled();
    });

    it('resolve o domínio público pelo identificador publicado pela Shopify', async () => {
      (lookup as jest.Mock).mockResolvedValue([{ address: '23.227.38.65', family: 4 }]);
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        text: async () => '<script>Shopify.shop = "loja-real.myshopify.com";</script>',
      } as Response);

      await expect(service.resolveShopDomain('https://www.exemplo.com.br/'))
        .resolves.toBe('loja-real.myshopify.com');
    });

    it('bloqueia domínios que resolvem para rede privada', async () => {
      (lookup as jest.Mock).mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
      const fetchSpy = jest.spyOn(global, 'fetch');

      await expect(service.resolveShopDomain('http://localhost.exemplo.com'))
        .rejects.toThrow('Domínio de loja inválido');
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('recusa uma página que não identifica uma loja Shopify', async () => {
      (lookup as jest.Mock).mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        text: async () => '<html>site comum</html>',
      } as Response);

      await expect(service.resolveShopDomain('exemplo.com'))
        .rejects.toThrow('Não foi possível identificar essa loja Shopify');
    });
  });

  describe('exchangeSessionTokenForAccessToken', () => {
    it('solicita token offline expiring exigido para apps públicos', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          access_token: 'access-token',
          scope: 'read_orders',
          expires_in: 3600,
          refresh_token: 'refresh-token',
        }),
      } as Response);

      await service.exchangeSessionTokenForAccessToken(
        'x.myshopify.com',
        'session-token',
      );

      const [, request] = (global.fetch as jest.Mock).mock.calls[0];
      expect(JSON.parse(request.body)).toEqual(expect.objectContaining({
        client_id: 'client-id',
        requested_token_type: 'urn:shopify:params:oauth:token-type:offline-access-token',
        expiring: 1,
      }));
    });
  });

  describe('findOrCreateUserFromShopify', () => {
    it('isola a loja quando o e-mail já pertence a uma conta Asaas', async () => {
      userRepo.findOne
        .mockResolvedValueOnce({ id: 7, email: 'merchant@gmail.com', asaasCustomerId: 'cus_asaas' })
        .mockResolvedValueOnce({ id: 7, email: 'merchant@gmail.com', asaasCustomerId: 'cus_asaas' })
        .mockResolvedValueOnce(null);

      const user = await service.findOrCreateUserFromShopify(
        { email: 'merchant@gmail.com', name: 'Merchant' },
        'x.myshopify.com',
      );

      expect(userRepo.create).toHaveBeenCalledWith(expect.objectContaining({
        email: expect.stringMatching(/^merchant\+shopify-[a-f0-9]{12}@gmail\.com$/),
        active: true,
        role: 'user',
      }));
      expect(user.email).toMatch(/^merchant\+shopify-[a-f0-9]{12}@gmail\.com$/);
    });

    it('reutiliza a conta existente quando ela não possui cobrança incompatível', async () => {
      const existing = { id: 8, email: 'merchant@example.com', asaasCustomerId: null };
      userRepo.findOne.mockResolvedValue(existing);
      connectionRepo.find.mockResolvedValue([]);

      await expect(service.findOrCreateUserFromShopify(
        { email: 'merchant@example.com', name: 'Merchant' },
        'y.myshopify.com',
      )).resolves.toBe(existing);
      expect(userRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('registerWebhookEvent (dedupe)', () => {
    it('evento novo é processado', async () => {
      webhookEventRepo.insert.mockResolvedValue({});
      await expect(service.registerWebhookEvent('wh-1', 'orders/create', 'x.myshopify.com')).resolves.toBe(true);
    });

    it('reentrega do mesmo evento é ignorada', async () => {
      webhookEventRepo.insert.mockRejectedValue({ code: 'ER_DUP_ENTRY' });
      await expect(service.registerWebhookEvent('wh-1', 'orders/create', 'x.myshopify.com')).resolves.toBe(false);
    });

    it('sem header de id, processa (melhor que descartar)', async () => {
      await expect(service.registerWebhookEvent('', 'orders/create', 'x.myshopify.com')).resolves.toBe(true);
      expect(webhookEventRepo.insert).not.toHaveBeenCalled();
    });

    it('falha de infraestrutura no dedupe não bloqueia o webhook', async () => {
      webhookEventRepo.insert.mockRejectedValue(new Error('db down'));
      await expect(service.registerWebhookEvent('wh-2', 'orders/create', 'x.myshopify.com')).resolves.toBe(true);
    });
  });

  describe('mapOrderStatus', () => {
    const map = (o: any) => (service as any).mapOrderStatus(o);

    it('cancelamento vence fulfillment', () => {
      expect(map({ cancelled_at: '2026-01-01', fulfillment_status: 'fulfilled', financial_status: 'paid' })).toBe('cancelled');
    });

    it('estorno total vira cancelado', () => {
      expect(map({ financial_status: 'refunded' })).toBe('cancelled');
    });

    it('estorno parcial continua completado', () => {
      expect(map({ financial_status: 'partially_refunded' })).toBe('completed');
    });

    it('entregue quando fulfilled', () => {
      expect(map({ financial_status: 'paid', fulfillment_status: 'fulfilled' })).toBe('delivered');
    });

    it('pago sem envio vira completado', () => {
      expect(map({ financial_status: 'paid', fulfillment_status: 'unfulfilled' })).toBe('completed');
    });

    it('pendente de pagamento', () => {
      expect(map({ financial_status: 'pending' })).toBe('pending');
    });
  });

  describe('lineItemNetTotal', () => {
    const net = (i: any) => (service as any).lineItemNetTotal(i);

    it('usa preço com desconto e quantidade atual', () => {
      expect(net({ price: '10.00', quantity: 2, original_price: '15.00', original_quantity: 3 })).toBe(20);
    });

    it('item removido por edição zera o total', () => {
      expect(net({ price: '10.00', quantity: 0, original_quantity: 2 })).toBe(0);
    });
  });

  describe('mapOrderLineItem', () => {
    it('prefere quantidade atual e preço com desconto', () => {
      const mapped = (service as any).mapOrderLineItem({
        id: 'gid://shopify/LineItem/9',
        quantity: 5,
        currentQuantity: 3,
        originalUnitPriceSet: { shopMoney: { amount: '100.00', currencyCode: 'BRL' } },
        discountedUnitPriceSet: { shopMoney: { amount: '80.00', currencyCode: 'BRL' } },
      });

      expect(mapped.id).toBe('9');
      expect(mapped.quantity).toBe(3);
      expect(mapped.original_quantity).toBe(5);
      expect(mapped.price).toBe('80.00');
      expect(mapped.original_price).toBe('100.00');
      expect(mapped.currency).toBe('BRL');
    });
  });

  describe('makeGraphqlRequest — rate limit', () => {
    const callGraphql = () => (service as any).makeGraphqlRequest('x.myshopify.com', 'tok', '{ shop { name } }');

    beforeEach(() => {
      // Não esperar de verdade entre as tentativas.
      jest.spyOn(service as any, 'sleep').mockResolvedValue(undefined);
    });

    it('HTTP 200 com THROTTLED faz retry e retorna o sucesso seguinte', async () => {
      const throttled = {
        ok: true,
        status: 200,
        json: async () => ({
          errors: [{ extensions: { code: 'THROTTLED' } }],
          extensions: { cost: { requestedQueryCost: 100, throttleStatus: { currentlyAvailable: 0, restoreRate: 50 } } },
        }),
        headers: new Map(),
      };
      const success = {
        ok: true,
        status: 200,
        json: async () => ({ data: { shop: { name: 'Loja' } } }),
        headers: new Map(),
      };
      global.fetch = jest.fn().mockResolvedValueOnce(throttled).mockResolvedValueOnce(success) as any;

      const result = await callGraphql();

      expect(result.data.shop.name).toBe('Loja');
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('HTTP 429 faz retry respeitando o limite de tentativas', async () => {
      const tooMany = {
        ok: false,
        status: 429,
        json: async () => ({}),
        text: async () => 'rate limited',
        headers: { get: () => '0' },
      };
      global.fetch = jest.fn().mockResolvedValue(tooMany) as any;

      await expect(callGraphql()).rejects.toThrow(/Rate limit/);
      expect(global.fetch).toHaveBeenCalledTimes(5);
    });

    it('THROTTLED persistente falha em vez de devolver resultado vazio', async () => {
      const throttled = {
        ok: true,
        status: 200,
        json: async () => ({ errors: [{ extensions: { code: 'THROTTLED' } }] }),
        headers: new Map(),
      };
      global.fetch = jest.fn().mockResolvedValue(throttled) as any;

      await expect(callGraphql()).rejects.toThrow(/throttled/i);
    });
  });

  describe('processOrderWebhook', () => {
    const order = {
      id: 1234,
      email: 'cliente@x.com',
      created_at: '2026-08-01T10:00:00Z',
      financial_status: 'paid',
      fulfillment_status: 'unfulfilled',
      gateway: 'shopify_payments',
      discount_codes: [{ code: 'PROMO10' }],
      checkout_token: 'chk-1',
      customer: { id: '55', email: 'cliente@x.com', first_name: 'Ana', last_name: 'Silva', phone: '11999999999' },
      line_items: [
        { id: 'li-1', sku: 'SKU1', name: 'Produto 1', quantity: 2, original_quantity: 2, price: '50.00', original_price: '60.00' },
      ],
    };

    const run = (topic: string, data: any) => (service as any).processOrderWebhook(1, topic, data);

    beforeEach(() => {
      contactRepo.findOne.mockResolvedValue(null);
      contactRepo.save.mockImplementation(async (c) => ({ id: 77, ...c }));
      productRepo.findOne.mockResolvedValue({ id: 99, name: 'Produto 1' });
      saleRepo.findOne.mockResolvedValue(null);
    });

    it('cria venda com valor líquido e vincula contato', async () => {
      await run('orders/create', order);

      expect(saleRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          externalId: 'shopify_1234_li-1',
          quantity: 2,
          unitPrice: 50,
          totalValue: 100, // preço com desconto × quantidade atual
          status: 'completed',
          contactId: 77,
          couponCode: 'PROMO10',
          channel: 'shopify',
        }),
      );
    });

    it('contato novo guarda o id do cliente Shopify', async () => {
      await run('orders/create', order);
      expect(contactRepo.save).toHaveBeenCalledWith(expect.objectContaining({ externalId: '55', source: 'shopify' }));
    });

    it('casa contato existente por externalId mesmo com e-mail diferente', async () => {
      contactRepo.findOne.mockImplementation(async (opts: any) =>
        opts.where.externalId === '55' ? { id: 77, name: 'Ana', email: 'antigo@x.com', status: 'customer' } : null,
      );

      await run('orders/create', order);

      expect(contactRepo.findOne).toHaveBeenCalledWith({ where: { userId: 1, externalId: '55' } });
      expect(saleRepo.save).toHaveBeenCalledWith(expect.objectContaining({ contactId: 77 }));
    });

    it('reprocessamento atualiza a venda existente em vez de duplicar', async () => {
      saleRepo.findOne.mockResolvedValue({ id: 5, externalId: 'shopify_1234_li-1', status: 'pending', quantity: 2 });

      await run('orders/updated', order);

      expect(saleRepo.save).toHaveBeenCalledWith(expect.objectContaining({ id: 5, status: 'completed' }));
      expect(saleRepo.create).not.toHaveBeenCalled();
    });

    it('pedido cancelado marca a venda como cancelada', async () => {
      await run('orders/cancelled', { ...order, cancelled_at: '2026-08-02T10:00:00Z' });
      expect(saleRepo.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }));
    });

    it('marca o checkout de origem como recuperado', async () => {
      await run('orders/create', order);
      expect(saleRepo.update).toHaveBeenCalledWith(
        { userId: 1, externalId: 'chk-1', status: 'abandoned_cart' },
        { status: 'recovered_cart' },
      );
    });

    it('item zerado por edição não cria venda nova', async () => {
      await run('orders/updated', {
        ...order,
        line_items: [{ id: 'li-1', sku: 'SKU1', name: 'Produto 1', quantity: 0, original_quantity: 2, price: '50.00' }],
      });
      expect(saleRepo.save).not.toHaveBeenCalled();
    });

    it('webhook sem id de pedido é ignorado sem quebrar', async () => {
      await run('orders/create', { email: 'x@x.com' });
      expect(saleRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('campos de cliente por versão da API', () => {
    const setVersion = (v: string) => ((service as any).apiVersion = v);

    it('2026-07 usa defaultEmailAddress/defaultPhoneNumber', () => {
      setVersion('2026-07');
      const fields = (service as any).customerContactFields();
      expect(fields).toContain('defaultEmailAddress');
      expect(fields).toContain('defaultPhoneNumber');
      expect(fields).not.toContain('emailMarketingConsent');
    });

    it('2025-10 mantém os campos antigos (os novos não existem lá)', () => {
      setVersion('2025-10');
      const fields = (service as any).customerContactFields();
      expect(fields).toContain('emailMarketingConsent');
      expect(fields).not.toContain('defaultEmailAddress');
    });

    it('mapCustomerContact entende o shape novo', () => {
      const mapped = (service as any).mapCustomerContact({
        defaultEmailAddress: { emailAddress: 'a@x.com', marketingState: 'SUBSCRIBED' },
        defaultPhoneNumber: { phoneNumber: '+5511999999999', marketingState: 'NOT_SUBSCRIBED' },
      });
      expect(mapped).toEqual({
        email: 'a@x.com',
        phone: '+5511999999999',
        emailMarketingState: 'SUBSCRIBED',
        smsMarketingState: 'NOT_SUBSCRIBED',
      });
    });

    it('mapCustomerContact entende o shape antigo', () => {
      const mapped = (service as any).mapCustomerContact({
        email: 'b@x.com',
        phone: '11988887777',
        emailMarketingConsent: { marketingState: 'SUBSCRIBED' },
        smsMarketingConsent: { marketingState: 'SUBSCRIBED' },
      });
      expect(mapped.email).toBe('b@x.com');
      expect(mapped.phone).toBe('11988887777');
      expect(mapped.emailMarketingState).toBe('SUBSCRIBED');
    });

    it('cliente ausente não quebra o mapeamento', () => {
      expect((service as any).mapCustomerContact(null)).toEqual({
        email: null,
        phone: null,
        emailMarketingState: null,
        smsMarketingState: null,
      });
    });
  });

  describe('migrações REST → GraphQL', () => {
    beforeEach(() => {
      connectionRepo.findOne.mockResolvedValue({
        userId: 1,
        shop: 'loja.myshopify.com',
        isActive: true,
        accessToken: 'enc',
      });
      jest.spyOn(service, 'getAccessToken').mockResolvedValue('tok');
    });

    it('gift card usa giftCardCreate e devolve o código em texto', async () => {
      jest.spyOn(service as any, 'makeGraphqlRequest').mockResolvedValue({
        data: { giftCardCreate: { giftCardCode: 'ABCD1234EFGH5678', giftCard: { id: 'gid://shopify/GiftCard/1' }, userErrors: [] } },
      });

      const result = await service.createGiftCard(1, 'loja.myshopify.com', { initialValue: '50.00', customerId: '55' });

      expect(result).toEqual({ code: 'ABCD1234EFGH5678' });
      const [, , mutation, variables] = (service as any).makeGraphqlRequest.mock.calls[0];
      expect(mutation).toContain('giftCardCreate');
      // customerId precisa virar GID na mutation.
      expect(variables.input.customerId).toBe('gid://shopify/Customer/55');
    });

    it('gift card propaga userErrors da Shopify', async () => {
      jest.spyOn(service as any, 'makeGraphqlRequest').mockResolvedValue({
        data: { giftCardCreate: { giftCardCode: null, userErrors: [{ field: 'initialValue', message: 'Valor inválido' }] } },
      });

      await expect(
        service.createGiftCard(1, 'loja.myshopify.com', { initialValue: '-1' }),
      ).rejects.toThrow('Valor inválido');
    });

    it('createWebhook converte o tópico para o enum do GraphQL', async () => {
      jest.spyOn(service as any, 'makeGraphqlRequest').mockResolvedValue({
        data: {
          webhookSubscriptionCreate: {
            webhookSubscription: { id: 'gid://shopify/WebhookSubscription/7', topic: 'ORDERS_CREATE', endpoint: { callbackUrl: 'https://x/hook' } },
            userErrors: [],
          },
        },
      });

      const result = await service.createWebhook(1, 'loja.myshopify.com', 'orders/create', 'https://x/hook');

      const [, , , variables] = (service as any).makeGraphqlRequest.mock.calls[0];
      expect(variables.topic).toBe('ORDERS_CREATE');
      // Shape REST preservado para o controller/frontend.
      expect(result).toEqual({ id: '7', topic: 'orders/create', address: 'https://x/hook', format: 'json' });
    });

    it('listWebhooks devolve o shape REST a partir do GraphQL', async () => {
      jest.spyOn(service as any, 'makeGraphqlRequest').mockResolvedValue({
        data: {
          webhookSubscriptions: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [{ id: 'gid://shopify/WebhookSubscription/7', topic: 'ORDERS_PAID', endpoint: { callbackUrl: 'https://x/hook' } }],
          },
        },
      });

      const result = await service.listWebhooks(1, 'loja.myshopify.com');

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ id: '7', topic: 'orders/paid', address: 'https://x/hook' });
    });
  });

  describe('sync incremental', () => {
    const filter = (d?: Date | null) => (service as any).updatedSinceFilter(d);

    it('primeira sync (sem lastSyncAt) não filtra nada', () => {
      expect(filter(null)).toBe('');
      expect(filter(undefined)).toBe('');
    });

    it('syncs seguintes filtram por updated_at com folga de relógio', () => {
      const since = new Date('2026-08-10T12:00:00.000Z');
      const result = filter(since);
      expect(result).toContain("updated_at:>=");
      // 1 minuto antes, para tolerar diferença de relógio com a Shopify.
      expect(result).toContain('2026-08-10T11:59:00.000Z');
    });

    it('syncAll usa a MESMA marca em todos os syncs', async () => {
      const since = new Date('2026-08-10T12:00:00.000Z');
      jest.spyOn(service, 'getActiveConnection').mockResolvedValue({
        shop: 'loja.myshopify.com',
        lastSyncAt: since,
      } as any);
      const customers = jest.spyOn(service, 'syncCustomers').mockResolvedValue({ imported: 0, updated: 0 });
      const orders = jest.spyOn(service, 'syncOrders').mockResolvedValue({ imported: 0, updated: 0 });
      jest.spyOn(service, 'syncCheckouts').mockResolvedValue({ imported: 0, updated: 0 });
      jest.spyOn(service, 'syncProductsToCrm').mockResolvedValue({ imported: 0, updated: 0 });

      await service.syncAll(1, 'loja.myshopify.com');

      // Se cada sync relesse a conexão, o segundo veria lastSyncAt já atualizado
      // e não importaria nada.
      expect(customers).toHaveBeenCalledWith(1, 'loja.myshopify.com', since);
      expect(orders).toHaveBeenCalledWith(1, 'loja.myshopify.com', since);
    });
  });

  describe('findCustomerContacts', () => {
    it('busca por telefone usa SQL, sem carregar a base inteira', async () => {
      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([{ id: 9 }]),
      };
      contactRepo.createQueryBuilder.mockReturnValue(qb as any);
      contactRepo.find.mockResolvedValue([]);

      const result = await (service as any).findCustomerContacts(1, { phone: '+55 (11) 99999-9999' });

      expect(contactRepo.createQueryBuilder).toHaveBeenCalled();
      // find({ where: { userId } }) sem filtro carregaria todos os contatos.
      expect(contactRepo.find).not.toHaveBeenCalledWith({ where: { userId: 1 } });
      expect(result).toEqual([{ id: 9 }]);
    });

    it('telefone curto demais não dispara busca por telefone', async () => {
      contactRepo.find.mockResolvedValue([]);
      await (service as any).findCustomerContacts(1, { email: 'a@x.com', phone: '123' });
      expect(contactRepo.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  describe('cobrança de teste decidida por loja', () => {
    const okResponse = {
      ok: true,
      json: async () => ({
        data: {
          appSubscriptionCreate: {
            userErrors: [],
            appSubscription: { id: 'gid://shopify/AppSubscription/1', status: 'PENDING' },
            confirmationUrl: 'https://confirm',
          },
        },
      }),
    };
    const plan = { name: 'Pro', price: 34.9, interval: 'monthly', currencyCode: 'USD' };
    const sentTestFlag = () =>
      JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body).variables.test;

    beforeEach(() => {
      global.fetch = jest.fn().mockResolvedValue(okResponse) as any;
    });

    it('development store recebe cobrança de teste', async () => {
      jest.spyOn(service, 'isDevelopmentStore').mockResolvedValue(true);
      await service.createAppSubscription('dev.myshopify.com', 'tok', plan, 'https://ret');
      expect(sentTestFlag()).toBe(true);
    });

    it('loja real recebe cobrança real', async () => {
      jest.spyOn(service, 'isDevelopmentStore').mockResolvedValue(false);
      await service.createAppSubscription('real.myshopify.com', 'tok', plan, 'https://ret');
      expect(sentTestFlag()).toBe(false);
    });

    it('detecta dev store por shop.plan.partnerDevelopment', async () => {
      jest.spyOn(service as any, 'makeGraphqlRequest').mockResolvedValue({
        data: { shop: { plan: { partnerDevelopment: true } } },
      });
      await expect(service.isDevelopmentStore('dev.myshopify.com', 'tok')).resolves.toBe(true);
    });

    it('falha na detecção trata a loja como real (nunca dá cobrança grátis por engano)', async () => {
      jest.spyOn(service as any, 'makeGraphqlRequest').mockRejectedValue(new Error('timeout'));
      await expect(service.isDevelopmentStore('x.myshopify.com', 'tok')).resolves.toBe(false);
    });
  });

  describe('compliance — customers/data_request', () => {
    const payload = { customer: { id: 55, email: 'Cliente@X.com', phone: '+55 11 99999-9999' } };

    beforeEach(() => {
      connectionRepo.find.mockResolvedValue([{ userId: 1, shop: 'loja.myshopify.com' }]);
      contactRepo.find.mockResolvedValue([
        { id: 77, name: 'Ana', email: 'cliente@x.com', phone: '11999999999', externalId: '55', emailOptIn: true, smsOptIn: false, createdAt: new Date() },
      ]);
      saleRepo.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([{ id: 3, externalId: 'shopify_1_li1', totalValue: 100, createdAt: new Date() }]),
      } as any);
    });

    it('gera export com contato, vendas e consentimento', async () => {
      await service.handleComplianceWebhook('customers/data_request', 'loja.myshopify.com', payload);

      expect(dataRequestRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          shop: 'loja.myshopify.com',
          userId: 1,
          shopifyCustomerId: '55',
          customerEmail: 'cliente@x.com',
          status: 'completed',
        }),
      );
      const saved = dataRequestRepo.save.mock.calls[0][0];
      expect(saved.payload.contacts).toHaveLength(1);
      expect(saved.payload.contacts[0].marketingConsent).toEqual({ email: true, sms: false });
      expect(saved.payload.sales).toHaveLength(1);
    });

    it('notifica o merchant (o prazo de resposta é dele)', async () => {
      await service.handleComplianceWebhook('customers/data_request', 'loja.myshopify.com', payload);
      expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({ userId: 1 }));
    });

    it('loja sem conexão registra no_data em vez de falhar', async () => {
      connectionRepo.find.mockResolvedValue([]);
      await service.handleComplianceWebhook('customers/data_request', 'loja.myshopify.com', payload);
      expect(dataRequestRepo.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'no_data', userId: null }));
    });
  });

  describe('compliance — customers/redact', () => {
    beforeEach(() => {
      connectionRepo.find.mockResolvedValue([{ userId: 1, shop: 'loja.myshopify.com' }]);
      contactRepo.find.mockResolvedValue([{ id: 77, email: 'cliente@x.com', phone: '11999999999', externalId: '55' }]);
      contactRepo.delete.mockResolvedValue({ affected: 1 });
      saleRepo.delete.mockResolvedValue({ affected: 2 });
    });

    it('apaga contato, vendas e dados derivados', async () => {
      await service.handleComplianceWebhook('customers/redact', 'loja.myshopify.com', {
        customer: { id: 55, email: 'cliente@x.com' },
      });

      expect(saleRepo.delete).toHaveBeenCalled();
      expect(contactPurchaseRepo.delete).toHaveBeenCalled();
      expect(messageEventRepo.delete).toHaveBeenCalled();
      expect(contactRepo.delete).toHaveBeenCalled();
      expect(dataRequestRepo.delete).toHaveBeenCalledWith({
        shop: 'loja.myshopify.com',
        userId: 1,
        shopifyCustomerId: '55',
      });
      expect(dataRequestRepo.delete).toHaveBeenCalledWith({
        shop: 'loja.myshopify.com',
        userId: 1,
        customerEmail: 'cliente@x.com',
      });
    });

    it('casa o cliente pelo id da Shopify mesmo sem e-mail no payload', async () => {
      await service.handleComplianceWebhook('customers/redact', 'loja.myshopify.com', { customer: { id: 55 } });

      const whereArg = contactRepo.find.mock.calls[0][0].where;
      expect(whereArg).toContainEqual({ userId: 1, externalId: '55' });
      expect(contactRepo.delete).toHaveBeenCalled();
    });

    it('payload sem identificação nenhuma não apaga nada', async () => {
      await service.handleComplianceWebhook('customers/redact', 'loja.myshopify.com', { customer: {} });
      expect(contactRepo.delete).not.toHaveBeenCalled();
      expect(saleRepo.delete).not.toHaveBeenCalled();
    });
  });

  describe('compliance — shop/redact', () => {
    beforeEach(() => {
      connectionRepo.find.mockResolvedValue([{ userId: 1, shop: 'loja.myshopify.com' }]);
      contactRepo.find.mockResolvedValue([{ id: 77 }]);
      productRepo.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      } as any);
    });

    it('apaga dados da loja, exports, dedupe e conexões', async () => {
      await service.handleComplianceWebhook('shop/redact', 'loja.myshopify.com', {});

      expect(saleRepo.delete).toHaveBeenCalledWith({ userId: 1, channel: 'shopify' });
      expect(contactRepo.delete).toHaveBeenCalledWith({ userId: 1, source: 'shopify' });
      expect(dataRequestRepo.delete).toHaveBeenCalledWith({ shop: 'loja.myshopify.com', userId: 1 });
      expect(webhookEventRepo.delete).toHaveBeenCalledWith({ shop: 'loja.myshopify.com' });
      expect(connectionRepo.delete).toHaveBeenCalledWith({ shop: 'loja.myshopify.com' });
    });

    it('remove dados derivados antes do contato (FK sem cascade)', async () => {
      await service.handleComplianceWebhook('shop/redact', 'loja.myshopify.com', {});
      expect(contactPurchaseRepo.delete).toHaveBeenCalled();
      expect(messageEventRepo.delete).toHaveBeenCalled();
    });
  });

  describe('getDataRequest — isolamento entre contas', () => {
    it('dono acessa o próprio export', async () => {
      dataRequestRepo.findOne.mockResolvedValue({ id: 1, userId: 1, payload: {} });
      await expect(service.getDataRequest(1, 1)).resolves.toMatchObject({ id: 1 });
    });

    it('outro usuário não acessa export alheio', async () => {
      dataRequestRepo.findOne.mockResolvedValue({ id: 1, userId: 2, payload: {} });
      await expect(service.getDataRequest(1, 1)).rejects.toThrow();
    });
  });

  describe('handleWebhook — erros viram falha para a Shopify reentregar', () => {
    it('erro no processamento propaga (não responde 200 silencioso)', async () => {
      connectionRepo.find.mockResolvedValue([{ userId: 1, shop: 'x.myshopify.com', isActive: true }]);
      jest.spyOn(service as any, 'processOrderWebhook').mockRejectedValue(new Error('falha no banco'));

      await expect(service.handleWebhook('orders/create', 'x.myshopify.com', { id: 1 })).rejects.toThrow(/falha no banco/);
    });

    it('loja sem conexão ativa não gera erro', async () => {
      connectionRepo.find.mockResolvedValue([]);
      await expect(service.handleWebhook('orders/create', 'x.myshopify.com', { id: 1 })).resolves.toBeUndefined();
    });
  });

  describe('handleAppUninstalled — cobrança precisa ser reaprovada na reinstalação', () => {
    it('cancela a assinatura Shopify local e inativa o usuário', async () => {
      connectionRepo.find.mockResolvedValue([{ userId: 7, shop: 'x.myshopify.com', isActive: true }]);
      connectionRepo.findOne.mockResolvedValue(null);
      subscriptionRepo.find.mockResolvedValue([
        { id: 1, userId: 7, status: 'active', shopifySubscriptionId: 'gid://shopify/AppSubscription/1', cancelAtPeriodEnd: true },
        { id: 2, userId: 7, status: 'active', shopifySubscriptionId: null },
      ]);

      await service.handleAppUninstalled('x.myshopify.com');

      expect(subscriptionRepo.save).toHaveBeenCalledTimes(1);
      expect(subscriptionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1, status: 'canceled', cancelAtPeriodEnd: false, cancellationReason: 'app_uninstalled' }),
      );
      expect(userRepo.update).toHaveBeenCalledWith(7, { subscriptionStatus: 'inactive' });
    });

    it('mantém a assinatura se o usuário ainda tem outra loja Shopify ativa', async () => {
      connectionRepo.find.mockResolvedValue([{ userId: 7, shop: 'x.myshopify.com', isActive: true }]);
      connectionRepo.findOne.mockResolvedValue({ userId: 7, shop: 'y.myshopify.com', isActive: true });

      await service.handleAppUninstalled('x.myshopify.com');

      expect(subscriptionRepo.find).not.toHaveBeenCalled();
      expect(userRepo.update).not.toHaveBeenCalled();
    });

    it('não mexe no usuário sem assinatura Shopify', async () => {
      connectionRepo.find.mockResolvedValue([{ userId: 7, shop: 'x.myshopify.com', isActive: true }]);
      connectionRepo.findOne.mockResolvedValue(null);
      subscriptionRepo.find.mockResolvedValue([{ id: 2, userId: 7, status: 'active', shopifySubscriptionId: null }]);

      await service.handleAppUninstalled('x.myshopify.com');

      expect(subscriptionRepo.save).not.toHaveBeenCalled();
      expect(userRepo.update).not.toHaveBeenCalled();
    });
  });
});
