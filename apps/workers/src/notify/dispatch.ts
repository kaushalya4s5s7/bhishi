import { prisma } from '@bhishi/db';
import { logger } from '../config.js';
import type { NotifyJob } from '../queues.js';
import { emailProvider, NO_PUSH_SUBSCRIPTION_ERROR, pushProvider, whatsappProvider } from './providers.js';
import { render } from './templates.js';

/**
 * Core dispatch logic for a single notify job: builds the target list
 * (email/whatsapp/webpush), sends via the matching provider, logs every
 * attempt, and throws on any failure that BullMQ should retry.
 *
 * Extracted from notify.ts so it can be unit tested without constructing a
 * live BullMQ `Worker` or triggering that module's import-time side effects
 * (process.on(SIGTERM/SIGINT), notifyReady() logging).
 */
export async function processNotifyJob(job: NotifyJob, jobId?: string) {
  const { kind, email, whatsapp, userAddress } = job;
  const { subject, body } = render(job);

  // One log row per channel, so a partial failure is visible. Push is
  // additive — it never replaces email/WhatsApp — so it's appended whenever
  // a wallet address is known, regardless of the other targets present.
  const targets: Array<{ channel: 'email' | 'whatsapp' | 'webpush'; to: string }> = [];
  if (email) targets.push({ channel: 'email', to: email });
  if (whatsapp) targets.push({ channel: 'whatsapp', to: whatsapp });
  if (userAddress) targets.push({ channel: 'webpush', to: userAddress });

  if (targets.length === 0) {
    logger.warn({ kind, jobId }, 'notify job has no recipient; dropping');
    return;
  }

  const failures: string[] = [];

  for (const { channel, to } of targets) {
    const log = await prisma.notificationLog.create({
      data: {
        kind,
        channel,
        status: 'queued',
        jobId: jobId ?? null,
        email: channel === 'email' ? to : null,
        userAddress: userAddress ?? null,
      },
    });

    const provider = channel === 'email' ? emailProvider : channel === 'whatsapp' ? whatsappProvider : pushProvider;
    const res = await provider.send(to, subject, body);

    await prisma.notificationLog.update({
      where: { id: log.id },
      data: {
        status: res.ok ? 'sent' : 'failed',
        error: res.error ?? null,
        sentAt: res.ok ? new Date() : null,
      },
    });

    // "No push subscription for wallet" is a permanent condition, not a
    // transient provider hiccup — the wallet simply hasn't opted into push
    // notifications (or the account predates Task 8). Retrying via BullMQ's
    // exponential backoff (5 attempts) can't fix that, so it's excluded from
    // `failures`/the throw below to avoid a pointless retry storm. It's
    // still recorded as 'failed' in NotificationLog above for visibility.
    const isMissingPushSubscription = channel === 'webpush' && res.error === NO_PUSH_SUBSCRIPTION_ERROR;
    if (!res.ok && !isMissingPushSubscription) failures.push(`${channel}: ${res.error}`);
  }

  // Throw so BullMQ retries with backoff; the log rows above already record
  // what happened on this attempt.
  if (failures.length > 0) throw new Error(failures.join('; '));
}
