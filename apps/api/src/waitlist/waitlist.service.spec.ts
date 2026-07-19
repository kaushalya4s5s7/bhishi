import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service.js';
import { WaitlistService } from './waitlist.service.js';

describe('WaitlistService', () => {
  let service: WaitlistService;
  const upsert = jest.fn<(...args: any[]) => any>();

  beforeEach(async () => {
    upsert.mockReset().mockResolvedValue({ id: 'entry_1' });
    const moduleRef = await Test.createTestingModule({
      providers: [
        WaitlistService,
        { provide: PrismaService, useValue: { waitlistEntry: { upsert } } },
      ],
    }).compile();
    service = moduleRef.get(WaitlistService);
  });

  it('persists the entry, upserting on email so a resubmit is not an error', async () => {
    await service.create({ email: 'a@b.com', name: 'Ada' });

    expect(upsert).toHaveBeenCalledTimes(1);
    const arg = upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ email: 'a@b.com' });
    expect(arg.create.email).toBe('a@b.com');
    expect(arg.create.name).toBe('Ada');
    // Both branches must be present or a resubmit would throw on the unique key.
    expect(arg.update).toBeDefined();
  });

  it('only records a wallet address from a verified session, never the body', async () => {
    await service.create({ email: 'a@b.com', name: 'Ada' }, 'did:privy:123');
    expect(upsert.mock.calls[0][0].create.walletAddress).toBe('did:privy:123');

    upsert.mockClear();
    await service.create({ email: 'a@b.com', name: 'Ada' });
    expect(upsert.mock.calls[0][0].create.walletAddress).toBeNull();
  });

  it('normalises optional fields to null rather than leaving them undefined', async () => {
    await service.create({ email: 'a@b.com', name: 'Ada' });
    const created = upsert.mock.calls[0][0].create;
    expect(created.whatsapp).toBeNull();
    expect(created.circleSize).toBeNull();
    expect(created.wantsTryNow).toBe(false);
  });
});
