import { Worker } from 'bullmq';
import { prisma } from '@bhishi/db';
import { logger } from './config.js';
import { NOTIFY_QUEUE, redisConnection, type NotifyJob } from './queues.js';
import { emailProvider, notifyReady, whatsappProvider } from './notify/providers.js';
import { render } from './notify/templates.js';

/**
 * Notify worker: delivers queued messages and records every attempt in
 * NotificationLog for audit + debugging.
 *
 * Delivery is best-effort and NEVER load-bearing: a missed reminder is a UX
 * regression, not a fund risk — the contract's deadlines and reclaim paths
 * stand on their own if this worker is down.
 */
const worker = new Worker<NotifyJob>(
  NOTIFY_QUEUE,
  async (job) => {
    const { kind, email, whatsapp, userAddress } = job.data;
    const { subject, body } = render(job.data);

    // One log row per channel, so a partial failure is visible.
    const targets: Array<{ channel: 'email' | 'whatsapp'; to: string }> = [];
    if (email) targets.push({ channel: 'email', to: email });
    if (whatsapp) targets.push({ channel: 'whatsapp', to: whatsapp });

    if (targets.length === 0) {
      logger.warn({ kind, jobId: job.id }, 'notify job has no recipient; dropping');
      return;
    }

    const failures: string[] = [];

    for (const { channel, to } of targets) {
      const log = await prisma.notificationLog.create({
        data: {
          kind,
          channel,
          status: 'queued',
          jobId: job.id ?? null,
          email: channel === 'email' ? to : null,
          userAddress: userAddress ?? null,
        },
      });

      const provider = channel === 'email' ? emailProvider : whatsappProvider;
      const res = await provider.send(to, subject, body);

      await prisma.notificationLog.update({
        where: { id: log.id },
        data: {
          status: res.ok ? 'sent' : 'failed',
          error: res.error ?? null,
          sentAt: res.ok ? new Date() : null,
        },
      });

      if (!res.ok) failures.push(`${channel}: ${res.error}`);
    }

    // Throw so BullMQ retries with backoff; the log rows above already record
    // what happened on this attempt.
    if (failures.length > 0) throw new Error(failures.join('; '));
  },
  { connection: redisConnection, concurrency: 5 },
);

worker.on('completed', (job) => logger.info({ jobId: job.id, kind: job.name }, 'notification sent'));
worker.on('failed', (job, err) =>
  logger.error({ jobId: job?.id, kind: job?.name, attempts: job?.attemptsMade, err: err.message }, 'notification failed'),
);

const ready = notifyReady();
logger.info(
  { email: ready.email ? 'live' : 'LOG-ONLY', whatsapp: ready.whatsapp ? 'live' : 'LOG-ONLY' },
  'notify worker started',
);
if (!ready.email && !ready.whatsapp) {
  logger.warn(
    'No delivery providers configured (RESEND_API_KEY / TWILIO_*). Messages are logged, NOT delivered.',
  );
}

async function shutdown(sig: string) {
  logger.info({ sig }, 'shutting down notify worker');
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
