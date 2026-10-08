import { EmailService } from './email.service';

describe('EmailService', () => {
  const configService: any = {
    get: jest.fn((key: string, fallback?: any) => {
      const values: Record<string, string> = {
        ZENVIA_API_TOKEN: 'token-test',
        SMTP_FROM_EMAIL: 'padrao@nucleocrm.com.br',
        SMTP_FROM_NAME: 'Núcleo CRM',
      };
      return values[key] ?? fallback;
    }),
  };
  const settingsService: any = {
    get: jest.fn(async (_key: string, fallback: string) => fallback),
  };
  let service: EmailService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new EmailService(configService, settingsService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('usa o remetente personalizado e retorna o messageId da Zenvia', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'message-123' }),
    } as Response);

    const result = await service.sendEmail({
      to: 'cliente@destino.com',
      fromEmail: 'contato@empresa.com.br',
      fromName: 'Minha Empresa',
      subject: 'Teste',
      text: 'Conteúdo',
      externalId: 'campaign-1-contact-2',
    });

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(request.body));
    expect(body.from).toBe('contato@empresa.com.br');
    expect(body.representative.name).toBe('Minha Empresa');
    expect(body.externalId).toBe('campaign-1-contact-2');
    expect(result).toEqual({ messageId: 'message-123' });
  });
});
