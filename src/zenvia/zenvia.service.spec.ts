import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ZenviaService } from './zenvia.service';

describe('ZenviaService', () => {
  let service: ZenviaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ZenviaService,
        {
          // O serviço lê token/remetentes do ConfigService no construtor.
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, fallback = '') => {
              const values: Record<string, string> = {
                ZENVIA_API_TOKEN: 'test-token',
                ZENVIA_SMS_FROM: 'NUCLEO',
                ZENVIA_WHATSAPP_FROM: '5511999999999',
              };
              return values[key] ?? fallback;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<ZenviaService>(ZenviaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
