import { Worker } from 'bullmq';
import { prisma } from '@bhishi/db';
import { logger } from './config.js';
import { NOTIFY_QUEUE, redisConnection, type NotifyJob } from './queues.js';
import { notifyReady } from './notify/providers.js';
import { processNotifyJob } from './notify/dispatch.js';

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
  async (job) => processNotifyJob(job.data, job.id),
  { connection: redisConnection, concurrency: 5 },
);

worker.on('completed', (job) => logger.info({ jobId: job.id, kind: job.name }, 'notification sent'));
worker.on('failed', (job, err) =>
  logger.error({ jobId: job?.id, kind: job?.name, attempts: job?.attemptsMade, err: err.message }, 'notification failed'),
);

const ready = notifyReady();
logger.info(
  {
    email: ready.email ? 'live' : 'LOG-ONLY',
    whatsapp: ready.whatsapp ? 'live' : 'LOG-ONLY',
    webpush: ready.webpush ? 'live' : 'LOG-ONLY',
  },
  'notify worker started',
);
if (!ready.email && !ready.whatsapp && !ready.webpush) {
  logger.warn(
    'No delivery providers configured (RESEND_API_KEY / TWILIO_* / VAPID_*). Messages are logged, NOT delivered.',
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
