import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from './email.service';

describe('EmailService', () => {
  const create = jest.fn();
  let logSpy: jest.SpyInstance;

  async function make(config: Record<string, string | undefined>) {
    create.mockReset().mockResolvedValue({ id: 'log_1' });
    const moduleRef = await Test.createTestingModule({
      providers: [
        EmailService,
        { provide: ConfigService, useValue: { get: (k: string) => config[k] } },
        { provide: PrismaService, useValue: { notificationLog: { create } } },
      ],
    }).compile();
    return moduleRef.get(EmailService);
  }

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => logSpy.mockRestore());

  it('falls back to console logging when RESEND_API_KEY is unset, and still audits', async () => {
    const svc = await make({ RESEND_API_KEY: undefined });
    await svc.sendCircleInvite({
      to: 'a@b.com',
      circleAddress: '0xabc',
      inviteUrl: 'http://localhost:3000/circle/0xabc?invite=tok',
      inviter: '0xdead',
    });
    expect(logSpy).toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(1);
    const arg = create.mock.calls[0][0].data;
    expect(arg.channel).toBe('email');
    expect(arg.kind).toBe('circle_invite');
    expect(arg.email).toBe('a@b.com');
    expect(arg.status).toBe('sent');
  });

  it('records status=failed when the underlying send throws', async () => {
    logSpy.mockImplementation(() => { throw new Error('boom'); });
    const svc = await make({ RESEND_API_KEY: undefined });
    await svc.sendCircleInvite({
      to: 'a@b.com',
      circleAddress: '0xabc',
      inviteUrl: 'http://localhost:3000/circle/0xabc?invite=tok',
      inviter: '0xdead',
    });
    const arg = create.mock.calls[0][0].data;
    expect(arg.status).toBe('failed');
    expect(arg.error).toBeTruthy();
  });
});
