import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { CampaignSchedulerService } from './campaign-scheduler.service';
import { Campaign } from '../../entities/campaign.entity';
import { UserUsage } from '../../entities/user-usage.entity';
import { User } from '../../entities/user.entity';
import { Subscription } from '../../entities/subscription.entity';
import { CampaignQueue } from '../../entities/campaign-queue.entity';
import { Sale } from '../../entities/sale.entity';
import { Contact } from '../../entities/contact.entity';
import { CampaignClick } from '../../entities/campaign-click.entity';
import { CampaignCoupon } from '../../entities/campaign-coupon.entity';
import { CampaignMessageEvent } from '../../entities/campaign-message-event.entity';
import { EmailConnection } from '../../entities/email-connection.entity';
import { ZenviaService } from '../../zenvia/zenvia.service';
import { TwilioService } from '../../twilio/twilio.service';
import { ContactsService } from '../../contacts/contacts.service';
import { EmailService } from '../../email/email.service';
import { SmtpEmailService } from '../../email/smtp-email.service';
import { TwilioConnectionsService } from '../../twilio-connections/twilio-connections.service';
import { ShopifyService } from '../../shopify/shopify.service';
import { NuvemshopService } from '../../nuvemshop/nuvemshop.service';
import { LojaIntegradaService } from '../../loja-integrada/loja-integrada.service';
import { VtexService } from '../../vtex/vtex.service';
import { TrayService } from '../../tray/tray.service';

const mockRepository = () => ({
  find: jest.fn().mockResolvedValue([]),
  findOne: jest.fn(),
  save: jest.fn(),
  create: jest.fn((v) => v),
  update: jest.fn(),
  delete: jest.fn(),
});

describe('CampaignSchedulerService', () => {
  let service: CampaignSchedulerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CampaignSchedulerService,
        { provide: getRepositoryToken(Campaign), useFactory: mockRepository },
        { provide: getRepositoryToken(UserUsage), useFactory: mockRepository },
        { provide: getRepositoryToken(User), useFactory: mockRepository },
        { provide: getRepositoryToken(Subscription), useFactory: mockRepository },
        { provide: getRepositoryToken(CampaignQueue), useFactory: mockRepository },
        { provide: getRepositoryToken(Sale), useFactory: mockRepository },
        { provide: getRepositoryToken(Contact), useFactory: mockRepository },
        { provide: getRepositoryToken(CampaignClick), useFactory: mockRepository },
        { provide: getRepositoryToken(CampaignCoupon), useFactory: mockRepository },
        { provide: getRepositoryToken(CampaignMessageEvent), useFactory: mockRepository },
        { provide: getRepositoryToken(EmailConnection), useFactory: mockRepository },
        { provide: ZenviaService, useValue: {} },
        { provide: TwilioService, useValue: {} },
        { provide: ContactsService, useValue: {} },
        { provide: EmailService, useValue: {} },
        { provide: SmtpEmailService, useValue: {} },
        { provide: TwilioConnectionsService, useValue: {} },
        { provide: ShopifyService, useValue: {} },
        { provide: NuvemshopService, useValue: {} },
        { provide: LojaIntegradaService, useValue: {} },
        { provide: VtexService, useValue: {} },
        { provide: TrayService, useValue: {} },
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();

    service = module.get<CampaignSchedulerService>(CampaignSchedulerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('hasMarketingConsent', () => {
    const consent = (contact: any, channel: string) =>
      (service as any).hasMarketingConsent(contact, channel);

    it('bloqueia e-mail para quem se descadastrou na loja', () => {
      expect(consent({ emailOptIn: false }, 'email')).toBe(false);
    });

    it('permite e-mail para quem está inscrito', () => {
      expect(consent({ emailOptIn: true }, 'email')).toBe(true);
    });

    it('consentimento desconhecido (null) não bloqueia — bases antigas', () => {
      expect(consent({ emailOptIn: null, smsOptIn: null }, 'email')).toBe(true);
      expect(consent({ emailOptIn: null, smsOptIn: null }, 'sms')).toBe(true);
    });

    it('whatsapp segue o consentimento de SMS', () => {
      expect(consent({ smsOptIn: false }, 'whatsapp')).toBe(false);
      expect(consent({ smsOptIn: true }, 'whatsapp')).toBe(true);
    });

    it('opt-out de e-mail não bloqueia SMS', () => {
      expect(consent({ emailOptIn: false, smsOptIn: true }, 'sms')).toBe(true);
    });
  });
});
