import { Queue, type ConnectionOptions } from 'bullmq';
import { config } from './config.js';

/**
 * BullMQ needs maxRetriesPerRequest: null on the connection it uses for
 * blocking commands, or ioredis aborts long-lived workers.
 */
export const redisConnection: ConnectionOptions = {
  url: config.redisUrl,
  maxRetriesPerRequest: null,
} as unknown as ConnectionOptions;

export const NOTIFY_QUEUE = 'notify';

/** What a notify job carries. `kind` selects the message template. */
export type NotifyKind =
  | 'waitlist_welcome'
  | 'round_deadline_reminder'
  | 'payout_received'
  | 'slash_notice';

export interface NotifyJob {
  kind: NotifyKind;
  /** Recipient — at least one of these must be set. */
  email?: string;
  whatsapp?: string;
  /** Member's on-chain address, for the audit log. */
  userAddress?: string;
  /** Template variables (circle address, round, amount, deadline…). */
  vars?: Record<string, string | number>;
}

/**
 * Shared retry policy: transient provider/network failures are common, so back
 * off exponentially rather than dropping the message.
 */
export const defaultJobOptions = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 5_000 },
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};

export const notifyQueue = new Queue<NotifyJob>(NOTIFY_QUEUE, {
  connection: redisConnection,
  defaultJobOptions,
});

/**
 * Enqueue a notification.
 *
 * `jobId` makes this idempotent: the indexer re-scans overlapping block ranges
 * on restart, so the same payout/slash event can be observed more than once.
 * BullMQ drops a job whose id already exists, so a caller passing a stable id
 * (e.g. `${txHash}:${logIndex}`) can enqueue freely without spamming members.
 */
export async function enqueueNotify(job: NotifyJob, jobId?: string, delayMs?: number) {
  return notifyQueue.add(job.kind, job, {
    ...(jobId ? { jobId } : {}),
    ...(delayMs && delayMs > 0 ? { delay: delayMs } : {}),
  });
}
