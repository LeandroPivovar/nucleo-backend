import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { AsaasService } from './asaas.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ShopifyService } from '../shopify/shopify.service';
import { Subscription } from '../entities/subscription.entity';
import { Plan } from '../entities/plan.entity';
import { Invoice } from '../entities/invoice.entity';
import { User } from '../entities/user.entity';
import { Contact } from '../entities/contact.entity';
import { UserUsage } from '../entities/user-usage.entity';
import { Campaign } from '../entities/campaign.entity';
import { ReferralCommission } from '../entities/referral-commission.entity';
import { TemplateRequest } from '../entities/template-request.entity';
import { SystemSetting } from '../entities/system-setting.entity';

const mockRepository = () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  save: jest.fn(),
  create: jest.fn((v) => v),
  update: jest.fn(),
  delete: jest.fn(),
  createQueryBuilder: jest.fn(() => ({
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(null),
  })),
});

describe('SubscriptionsService — billing Shopify + regressão Asaas', () => {
  let service: SubscriptionsService;
  let subscriptionRepo: ReturnType<typeof mockRepository>;
  let planRepo: ReturnType<typeof mockRepository>;
  let userRepo: ReturnType<typeof mockRepository>;
  let asaasService: { cancelSubscription: jest.Mock };
  let shopifyService: {
    getConnections: jest.Mock;
    getAccessToken: jest.Mock;
    createAppSubscription: jest.Mock;
    cancelAppSubscription: jest.Mock;
  };

  beforeEach(async () => {
    asaasService = { cancelSubscription: jest.fn() };
    shopifyService = {
      getConnections: jest.fn(),
      getAccessToken: jest.fn(),
      createAppSubscription: jest.fn(),
      cancelAppSubscription: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionsService,
        { provide: getRepositoryToken(Subscription), useFactory: mockRepository },
        { provide: getRepositoryToken(Plan), useFactory: mockRepository },
        { provide: getRepositoryToken(Invoice), useFactory: mockRepository },
        { provide: getRepositoryToken(User), useFactory: mockRepository },
        { provide: getRepositoryToken(Contact), useFactory: mockRepository },
        { provide: getRepositoryToken(UserUsage), useFactory: mockRepository },
        { provide: getRepositoryToken(Campaign), useFactory: mockRepository },
        { provide: getRepositoryToken(ReferralCommission), useFactory: mockRepository },
        { provide: getRepositoryToken(TemplateRequest), useFactory: mockRepository },
        { provide: getRepositoryToken(SystemSetting), useFactory: mockRepository },
        { provide: AsaasService, useValue: asaasService },
        { provide: NotificationsService, useValue: { createNotification: jest.fn() } },
        { provide: ShopifyService, useValue: shopifyService },
      ],
    }).compile();

    service = module.get(SubscriptionsService);
    subscriptionRepo = module.get(getRepositoryToken(Subscription));
    planRepo = module.get(getRepositoryToken(Plan));
    userRepo = module.get(getRepositoryToken(User));
  });

  describe('resolvePaymentGatewayForUser (regressão Asaas)', () => {
    it('usuário sem loja Shopify continua no Asaas', async () => {
      shopifyService.getConnections.mockResolvedValue([]);
      await expect(service.resolvePaymentGatewayForUser(1)).resolves.toBe('asaas');
    });

    it('usuário com conexão Shopify inativa continua no Asaas', async () => {
      shopifyService.getConnections.mockResolvedValue([{ shop: 'x.myshopify.com', isActive: false }]);
      await expect(service.resolvePaymentGatewayForUser(1)).resolves.toBe('asaas');
    });

    it('merchant Shopify (conexão ativa) usa Shopify Billing', async () => {
      shopifyService.getConnections.mockResolvedValue([{ shop: 'x.myshopify.com', isActive: true }]);
      await expect(service.resolvePaymentGatewayForUser(1)).resolves.toBe('shopify');
    });
  });

  describe('shopifyCheckout — moeda', () => {
    const user = { id: 1, email: 'u@x.com' };
    const connection = { shop: 'loja.myshopify.com', isActive: true };

    beforeEach(() => {
      userRepo.findOne.mockResolvedValue(user);
      shopifyService.getConnections.mockResolvedValue([connection]);
      shopifyService.getAccessToken.mockResolvedValue('token');
      shopifyService.createAppSubscription.mockResolvedValue({
        confirmationUrl: 'https://confirm',
        appSubscriptionId: 'gid://shopify/AppSubscription/1',
      });
      subscriptionRepo.save.mockImplementation(async (s) => ({ id: 10, ...s }));
    });

    it('recusa plano sem priceUsd (nunca cobrar valor BRL como USD)', async () => {
      planRepo.findOne.mockResolvedValue({ id: 2, name: 'Pro', price: 169.99, priceUsd: null, interval: 'monthly' });
      await expect(service.shopifyCheckout(1, { planId: 2 })).rejects.toThrow(BadRequestException);
      expect(shopifyService.createAppSubscription).not.toHaveBeenCalled();
    });

    it('cobra o preço USD explícito do plano, em USD', async () => {
      planRepo.findOne.mockResolvedValue({ id: 2, name: 'Pro', price: 169.99, priceUsd: '34.90', interval: 'monthly' });

      await service.shopifyCheckout(1, { planId: 2 });

      expect(shopifyService.createAppSubscription).toHaveBeenCalledWith(
        'loja.myshopify.com',
        'token',
        expect.objectContaining({ price: 34.9, currencyCode: 'USD' }),
        expect.stringContaining('/shopify/billing/callback?shop='),
        0,
      );
    });

    it('returnUrl não carrega userId nem planId', async () => {
      planRepo.findOne.mockResolvedValue({ id: 2, name: 'Pro', price: 169.99, priceUsd: '34.90', interval: 'monthly' });

      await service.shopifyCheckout(1, { planId: 2 });

      const returnUrl: string = shopifyService.createAppSubscription.mock.calls[0][3];
      expect(returnUrl).not.toContain('userId');
      expect(returnUrl).not.toContain('planId');
    });
  });

  describe('cancelSubscription — cobrança Shopify', () => {
    it('encerra a recorrência Shopify e mantém o acesso local por 30 dias', async () => {
      const subscription = {
        id: 10,
        userId: 1,
        status: 'active',
        cancelAtPeriodEnd: false,
        currentPeriodEnd: new Date('2026-10-01T00:00:00.000Z'),
        shopifySubscriptionId: 'gid://shopify/AppSubscription/10',
      };
      subscriptionRepo.findOne.mockResolvedValue(subscription);
      shopifyService.getConnections.mockResolvedValue([
        { shop: 'loja.myshopify.com', isActive: true },
      ]);
      shopifyService.getAccessToken.mockResolvedValue('token');
      shopifyService.cancelAppSubscription.mockResolvedValue({
        id: subscription.shopifySubscriptionId,
        status: 'CANCELLED',
      });

      await expect(service.cancelSubscription(1)).resolves.toEqual(
        expect.objectContaining({ success: true }),
      );

      expect(shopifyService.cancelAppSubscription).toHaveBeenCalledWith(
        'loja.myshopify.com',
        'token',
        subscription.shopifySubscriptionId,
      );
      expect(subscriptionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'active', cancelAtPeriodEnd: true }),
      );
      expect(
        subscriptionRepo.save.mock.invocationCallOrder[0],
      ).toBeLessThan(shopifyService.cancelAppSubscription.mock.invocationCallOrder[0]);
    });

    it('restaura o período anterior se não conseguir cancelar na Shopify', async () => {
      const previousPeriodEnd = new Date('2026-10-01T00:00:00.000Z');
      const subscription = {
        id: 10,
        userId: 1,
        status: 'active',
        cancelAtPeriodEnd: false,
        currentPeriodEnd: previousPeriodEnd,
        shopifySubscriptionId: 'gid://shopify/AppSubscription/10',
      };
      subscriptionRepo.findOne.mockResolvedValue(subscription);
      shopifyService.getConnections.mockResolvedValue([]);

      await expect(service.cancelSubscription(1)).rejects.toThrow(BadRequestException);
      expect(shopifyService.cancelAppSubscription).not.toHaveBeenCalled();
      expect(subscriptionRepo.save).toHaveBeenCalledTimes(2);
      expect(subscription).toEqual(expect.objectContaining({
        status: 'active',
        cancelAtPeriodEnd: false,
        currentPeriodEnd: previousPeriodEnd,
      }));
    });

    it('cancela a recorrência Asaas sem cortar o acesso local', async () => {
      subscriptionRepo.findOne.mockResolvedValue({
        id: 11,
        userId: 1,
        status: 'active',
        cancelAtPeriodEnd: false,
        currentPeriodEnd: new Date('2026-10-01T00:00:00.000Z'),
        asaasSubscriptionId: 'sub_asaas_1',
      });
      asaasService.cancelSubscription.mockResolvedValue({ deleted: true });

      await service.cancelSubscription(1);

      expect(asaasService.cancelSubscription).toHaveBeenCalledWith('sub_asaas_1');
      expect(subscriptionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'active', cancelAtPeriodEnd: true }),
      );
    });
  });

  describe('handleShopifySubscriptionsUpdateWebhook — status oficiais', () => {
    const gid = 'gid://shopify/AppSubscription/55';
    const baseSub = () => ({
      id: 7,
      userId: 1,
      planId: 2,
      status: 'pending',
      user: { id: 1 },
    });

    it('ACTIVE ativa a assinatura, cancela outras ativas e atualiza o usuário', async () => {
      const sub = baseSub();
      subscriptionRepo.findOne.mockResolvedValue(sub);
      planRepo.findOne.mockResolvedValue({ id: 2, interval: 'monthly' });

      await service.handleShopifySubscriptionsUpdateWebhook(
        { app_subscription: { admin_graphql_api_id: gid, status: 'ACTIVE' } },
        'loja.myshopify.com',
      );

      expect(subscriptionRepo.update).toHaveBeenCalledWith(
        { userId: 1, status: 'active' },
        { status: 'canceled' },
      );
      expect(subscriptionRepo.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'active' }));
      expect(userRepo.update).toHaveBeenCalledWith(1, expect.objectContaining({ subscriptionStatus: 'active' }));
    });

    it('FROZEN suspende sem cancelar', async () => {
      const sub = baseSub();
      sub.status = 'active';
      subscriptionRepo.findOne.mockResolvedValue(sub);

      await service.handleShopifySubscriptionsUpdateWebhook(
        { app_subscription: { admin_graphql_api_id: gid, status: 'FROZEN' } },
        'loja.myshopify.com',
      );

      expect(subscriptionRepo.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'frozen' }));
      expect(userRepo.update).toHaveBeenCalledWith(1, { subscriptionStatus: 'inactive' });
    });

    it('CANCELLED cancela e desativa o usuário', async () => {
      subscriptionRepo.findOne.mockResolvedValue(baseSub());

      await service.handleShopifySubscriptionsUpdateWebhook(
        { app_subscription: { admin_graphql_api_id: gid, status: 'CANCELLED' } },
        'loja.myshopify.com',
      );

      expect(subscriptionRepo.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'canceled' }));
      expect(userRepo.update).toHaveBeenCalledWith(1, { subscriptionStatus: 'inactive' });
    });

    it('CANCELLED mantém acesso quando o cancelamento foi agendado localmente', async () => {
      const sub = {
        ...baseSub(),
        status: 'active',
        cancelAtPeriodEnd: true,
        currentPeriodEnd: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      };
      subscriptionRepo.findOne.mockResolvedValue(sub);

      await service.handleShopifySubscriptionsUpdateWebhook(
        { app_subscription: { admin_graphql_api_id: gid, status: 'CANCELLED' } },
        'loja.myshopify.com',
      );

      expect(subscriptionRepo.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'active' }));
      expect(userRepo.update).toHaveBeenCalledWith(1, { subscriptionStatus: 'active' });
    });

    it('PAST_DUE (status inexistente em AppSubscription) não altera nada', async () => {
      subscriptionRepo.findOne.mockResolvedValue(baseSub());

      await service.handleShopifySubscriptionsUpdateWebhook(
        { app_subscription: { admin_graphql_api_id: gid, status: 'PAST_DUE' } },
        'loja.myshopify.com',
      );

      expect(subscriptionRepo.save).not.toHaveBeenCalled();
      expect(userRepo.update).not.toHaveBeenCalled();
    });
  });
});
