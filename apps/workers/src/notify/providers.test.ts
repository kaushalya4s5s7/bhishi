import { describe, it, expect, vi, beforeEach } from 'vitest';

const findManyMock = vi.fn();
const deleteManyMock = vi.fn();

vi.mock('@bhishi/db', () => ({
  prisma: {
    pushSubscription: {
      findMany: (...args: unknown[]) => findManyMock(...args),
      deleteMany: (...args: unknown[]) => deleteManyMock(...args),
    },
  },
}));

const sendNotificationMock = vi.fn();
const setVapidDetailsMock = vi.fn();

vi.mock('web-push', () => ({
  default: {
    setVapidDetails: (...args: unknown[]) => setVapidDetailsMock(...args),
    sendNotification: (...args: unknown[]) => sendNotificationMock(...args),
  },
}));

vi.mock('../config.js', () => ({
  logger: { warn: vi.fn() },
  config: {
    vapidPublic: 'test-public-key',
    vapidPrivate: 'test-private-key',
    vapidSubject: 'mailto:hello@bhishi.app',
  },
}));

describe('WebPushProvider (via pushProvider)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns not-ok when the wallet has no push subscriptions', async () => {
    findManyMock.mockResolvedValue([]);
    const { pushProvider } = await import('./providers.js');

    const res = await pushProvider.send('0xabc', 'subject', 'body');

    expect(res.ok).toBe(false);
    expect(sendNotificationMock).not.toHaveBeenCalled();
  });

  it('prunes a subscription that 410s and still reports failure if it was the only one', async () => {
    findManyMock.mockResolvedValue([
      { endpoint: 'https://push.example/dead', p256dh: 'p', auth: 'a' },
    ]);
    sendNotificationMock.mockRejectedValue({ statusCode: 410 });
    const { pushProvider } = await import('./providers.js');

    const res = await pushProvider.send('0xabc', 'subject', 'body');

    expect(deleteManyMock).toHaveBeenCalledWith({ where: { endpoint: 'https://push.example/dead' } });
    expect(res.ok).toBe(false);
  });

  it('does not prune on a non-404/410 error and reports the failure detail', async () => {
    findManyMock.mockResolvedValue([
      { endpoint: 'https://push.example/flaky', p256dh: 'p', auth: 'a' },
    ]);
    sendNotificationMock.mockRejectedValue({ statusCode: 500, message: 'push service unavailable' });
    const { pushProvider } = await import('./providers.js');

    const res = await pushProvider.send('0xabc', 'subject', 'body');

    expect(deleteManyMock).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
    expect(res.error).toContain('500');
  });

  it('succeeds and does not prune when at least one subscription sends successfully', async () => {
    findManyMock.mockResolvedValue([
      { endpoint: 'https://push.example/alive', p256dh: 'p', auth: 'a' },
    ]);
    sendNotificationMock.mockResolvedValue(undefined);
    const { pushProvider } = await import('./providers.js');

    const res = await pushProvider.send('0xabc', 'subject', 'body');

    expect(res.ok).toBe(true);
    expect(deleteManyMock).not.toHaveBeenCalled();
  });
});
