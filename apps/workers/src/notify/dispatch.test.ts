import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NotifyJob } from '../queues.js';

const createMock = vi.fn();
const updateMock = vi.fn();

vi.mock('@bhishi/db', () => ({
  prisma: {
    notificationLog: {
      create: (...args: unknown[]) => createMock(...args),
      update: (...args: unknown[]) => updateMock(...args),
    },
  },
}));

vi.mock('../config.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const emailSend = vi.fn();
const whatsappSend = vi.fn();
const pushSend = vi.fn();

vi.mock('./providers.js', () => ({
  emailProvider: { name: 'email', send: (...args: unknown[]) => emailSend(...args) },
  whatsappProvider: { name: 'whatsapp', send: (...args: unknown[]) => whatsappSend(...args) },
  pushProvider: { name: 'webpush', send: (...args: unknown[]) => pushSend(...args) },
  NO_PUSH_SUBSCRIPTION_ERROR: 'no push subscription for wallet',
}));

vi.mock('./templates.js', () => ({
  render: () => ({ subject: 'subject', body: 'body' }),
}));

const baseJob: NotifyJob = { kind: 'waitlist_welcome' };

describe('processNotifyJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createMock.mockResolvedValue({ id: 'log-1' });
    updateMock.mockResolvedValue(undefined);
  });

  it('dispatches exactly one webpush target when only userAddress is present', async () => {
    const { processNotifyJob } = await import('./dispatch.js');
    pushSend.mockResolvedValue({ ok: true });

    await processNotifyJob({ ...baseJob, userAddress: '0xabc' });

    expect(pushSend).toHaveBeenCalledTimes(1);
    expect(pushSend).toHaveBeenCalledWith('0xabc', 'subject', 'body');
    expect(emailSend).not.toHaveBeenCalled();
    expect(whatsappSend).not.toHaveBeenCalled();
  });

  it('dispatches both email and webpush targets when email + userAddress are present (push is additive)', async () => {
    const { processNotifyJob } = await import('./dispatch.js');
    emailSend.mockResolvedValue({ ok: true });
    pushSend.mockResolvedValue({ ok: true });

    await processNotifyJob({ ...baseJob, email: 'a@b.com', userAddress: '0xabc' });

    expect(emailSend).toHaveBeenCalledTimes(1);
    expect(emailSend).toHaveBeenCalledWith('a@b.com', 'subject', 'body');
    expect(pushSend).toHaveBeenCalledTimes(1);
    expect(pushSend).toHaveBeenCalledWith('0xabc', 'subject', 'body');
    expect(whatsappSend).not.toHaveBeenCalled();
  });

  it('does not throw when the only failure is a missing push subscription', async () => {
    const { processNotifyJob } = await import('./dispatch.js');
    emailSend.mockResolvedValue({ ok: true });
    pushSend.mockResolvedValue({ ok: false, error: 'no push subscription for wallet' });

    await expect(
      processNotifyJob({ ...baseJob, email: 'a@b.com', userAddress: '0xabc' }),
    ).resolves.toBeUndefined();
  });

  it('throws when webpush fails with a real error', async () => {
    const { processNotifyJob } = await import('./dispatch.js');
    pushSend.mockResolvedValue({ ok: false, error: 'vapid misconfigured' });

    await expect(
      processNotifyJob({ ...baseJob, userAddress: '0xabc' }),
    ).rejects.toThrow('webpush: vapid misconfigured');
  });

  it('throws when email fails, even if webpush succeeds', async () => {
    const { processNotifyJob } = await import('./dispatch.js');
    emailSend.mockResolvedValue({ ok: false, error: 'resend 500' });
    pushSend.mockResolvedValue({ ok: true });

    await expect(
      processNotifyJob({ ...baseJob, email: 'a@b.com', userAddress: '0xabc' }),
    ).rejects.toThrow('email: resend 500');
  });

  it('throws when whatsapp fails', async () => {
    const { processNotifyJob } = await import('./dispatch.js');
    whatsappSend.mockResolvedValue({ ok: false, error: 'twilio 500' });

    await expect(
      processNotifyJob({ ...baseJob, whatsapp: '+1234567890' }),
    ).rejects.toThrow('whatsapp: twilio 500');
  });
});
