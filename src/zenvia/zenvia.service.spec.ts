import { Test, TestingModule } from '@nestjs/testing';
import { ZenviaService } from './zenvia.service';

describe('ZenviaService', () => {
  let service: ZenviaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ZenviaService],
    }).compile();

    service = module.get<ZenviaService>(ZenviaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
