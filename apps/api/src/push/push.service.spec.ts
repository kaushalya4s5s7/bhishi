import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service.js';
import { PushService } from './push.service.js';

describe('PushService', () => {
  let service: PushService;
  const upsert = jest.fn<(...args: any[]) => any>();
  const deleteMany = jest.fn<(...args: any[]) => any>();

  beforeEach(async () => {
    upsert.mockReset().mockResolvedValue({ id: 'sub_1' });
    deleteMany.mockReset().mockResolvedValue({ count: 1 });
    const moduleRef = await Test.createTestingModule({
      providers: [
        PushService,
        { provide: PrismaService, useValue: { pushSubscription: { upsert, deleteMany } } },
      ],
    }).compile();
    service = moduleRef.get(PushService);
  });

  it('lowercases the wallet address and upserts on endpoint', async () => {
    await service.save('0xABC', { endpoint: 'e1', p256dh: 'p', auth: 'a' });

    expect(upsert).toHaveBeenCalledTimes(1);
    const arg = upsert.mock.calls[0][0] as any;
    expect(arg.where).toEqual({ endpoint: 'e1' });
    expect(arg.create).toEqual({ endpoint: 'e1', walletAddress: '0xabc', p256dh: 'p', auth: 'a' });
    expect(arg.update).toEqual({ walletAddress: '0xabc', p256dh: 'p', auth: 'a' });
  });

  it('removes the subscription by endpoint', async () => {
    const result = await service.remove('e1');

    expect(deleteMany).toHaveBeenCalledWith({ where: { endpoint: 'e1' } });
    expect(result).toEqual({ ok: true });
  });
});
