import { CampaignsService } from './campaigns.service';
import { Campaign } from '../entities/campaign.entity';
import { CampaignMessageEvent } from '../entities/campaign-message-event.entity';

describe('CampaignsService - webhook de e-mail', () => {
  it('atribui a entrega à campanha correta e não duplica o contador', async () => {
    const event: any = {
      id: 1,
      campaignId: 315,
      contactId: 99,
      messageSid: 'message-123',
      provider: 'zenvia-email',
      status: 'accepted',
      deliveredAt: null,
    };
    const eventRepository: any = {
      createQueryBuilder: jest.fn(() => ({
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn(async () => event),
      })),
      save: jest.fn(async (value) => value),
    };
    const campaignRepositoryInTransaction: any = {
      increment: jest.fn(async () => undefined),
    };
    const manager: any = {
      getRepository: jest.fn((entity) => entity === CampaignMessageEvent
        ? eventRepository
        : campaignRepositoryInTransaction),
    };
    const campaignMessageEventsRepository: any = {
      manager: {
        transaction: jest.fn(async (callback) => callback(manager)),
      },
    };
    const emptyRepository: any = {};
    const service = new CampaignsService(
      emptyRepository,
      emptyRepository,
      emptyRepository,
      emptyRepository,
      emptyRepository,
      emptyRepository,
      emptyRepository,
      emptyRepository,
      campaignMessageEventsRepository,
      emptyRepository,
      emptyRepository,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    const payload = {
      channel: 'email',
      messageId: 'message-123',
      messageStatus: { code: 'DELIVERED' },
    };
    await service.handleDeliveredWebhook(payload);
    await service.handleDeliveredWebhook(payload);

    expect(campaignRepositoryInTransaction.increment).toHaveBeenCalledTimes(1);
    expect(campaignRepositoryInTransaction.increment).toHaveBeenCalledWith(
      { id: 315 },
      'deliveredCount',
      1,
    );
    expect(event.deliveredAt).toBeInstanceOf(Date);
  });
});
