import { Test, TestingModule } from '@nestjs/testing';
import { CampaignSchedulerService } from './campaign-scheduler.service';

describe('CampaignSchedulerService', () => {
  let service: CampaignSchedulerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CampaignSchedulerService],
    }).compile();

    service = module.get<CampaignSchedulerService>(CampaignSchedulerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
