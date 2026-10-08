import { BadRequestException } from '@nestjs/common';
import { EmailConnectionsService } from './email-connections.service';

describe('EmailConnectionsService', () => {
  const repository: any = {
    findOne: jest.fn(),
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => ({ id: 1, ...value })),
  };
  let service: EmailConnectionsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new EmailConnectionsService(repository);
  });

  it('exige que o remetente pertença ao domínio solicitado', async () => {
    await expect(service.create(7, {
      type: 'domain',
      domain: 'empresa.com.br',
      email: 'contato@outro-dominio.com.br',
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('normaliza e salva domínio e remetente como pendentes', async () => {
    repository.findOne.mockResolvedValue(null);

    const result = await service.create(7, {
      type: 'domain',
      domain: 'https://www.Empresa.com.br/',
      email: ' Contato@Empresa.com.br ',
      senderName: ' Minha Empresa ',
    });

    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({
      domain: 'empresa.com.br',
      email: 'contato@empresa.com.br',
      senderName: 'Minha Empresa',
      status: 'pending',
    }));
    expect(result.email).toBe('contato@empresa.com.br');
  });

  it('obriga nova validação quando o remetente é alterado', async () => {
    const connection: any = {
      id: 12,
      userId: 7,
      domain: 'empresa.com.br',
      email: 'antigo@empresa.com.br',
      senderName: 'Antigo',
      status: 'verified',
      verifiedAt: new Date(),
    };
    repository.findOne
      .mockResolvedValueOnce(connection)
      .mockResolvedValueOnce(null);

    const result = await service.update(12, 7, {
      email: 'novo@empresa.com.br',
      senderName: 'Novo',
    });

    expect(result.status).toBe('pending');
    expect(result.verifiedAt).toBeNull();
  });
});
