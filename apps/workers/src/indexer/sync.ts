import type { PublicClient } from 'viem';
import { parseAbiItem } from 'viem';
import { circleAbi } from '@bhishi/shared';
import { getCircleEventsChunked, DEFAULT_CHUNK_SIZE } from '@bhishi/events';
import { prisma, Prisma, type CircleMode, type CircleState } from '@bhishi/db';
import { logger } from '../config.js';
import { enqueueNotify, type NotifyKind } from '../queues.js';

/** Ordinal -> name, matching Circle.sol's State enum exactly. */
const STATE_BY_ORDINAL: CircleState[] = [
  'FILLING',
  'ACTIVE',
  'ABORTED_FILLING',
  'COMMIT',
  'REVEAL',
  'DRAW',
  'PAYOUT',
  'COMPLETED',
  'STALLED',
];

const MODE_BY_ORDINAL: CircleMode[] = ['LUCKY_DRAW', 'AUCTION'];

export const circleCreatedEvent = parseAbiItem(
  'event CircleCreated(address indexed circle, address indexed creator, uint256 contribution, uint256 seats, uint256 bond, uint8 mode)',
);

/**
 * Discover circles created by the factory since `fromBlock` and persist them.
 * Idempotent: re-running over the same range upserts rather than duplicating.
 */
export async function syncFactory(
  client: PublicClient,
  factory: `0x${string}`,
  fromBlock: bigint,
  toBlock: bigint,
  chunkSize: bigint = DEFAULT_CHUNK_SIZE,
): Promise<number> {
  if (toBlock < fromBlock) return 0;

  // Chunked for the same reason as circle events: the RPC caps the span (Monad
  // testnet rejects >100 blocks outright with -32614).
  type CreatedLog = Awaited<ReturnType<typeof client.getLogs<typeof circleCreatedEvent>>>[number];
  const logs: CreatedLog[] = [];
  for (let start = fromBlock; start <= toBlock; start += chunkSize) {
    const end = start + chunkSize - 1n > toBlock ? toBlock : start + chunkSize - 1n;
    const chunk = await client.getLogs({
      address: factory,
      event: circleCreatedEvent,
      fromBlock: start,
      toBlock: end,
    });
    logs.push(...chunk);
  }

  for (const log of logs) {
    const a = log.args as {
      circle?: `0x${string}`;
      creator?: `0x${string}`;
      contribution?: bigint;
      seats?: bigint;
      bond?: bigint;
      mode?: number;
    };
    if (!a.circle) continue;

    const address = a.circle.toLowerCase();
    const block = await client.getBlock({ blockNumber: log.blockNumber! });

    await prisma.circle.upsert({
      where: { address },
      create: {
        address,
        factoryTx: log.transactionHash!,
        creator: (a.creator ?? '0x').toLowerCase(),
        seats: Number(a.seats ?? 0n),
        contribution: (a.contribution ?? 0n).toString(),
        bond: (a.bond ?? 0n).toString(),
        mode: MODE_BY_ORDINAL[Number(a.mode ?? 0)] ?? 'LUCKY_DRAW',
        createdAt: new Date(Number(block.timestamp) * 1000),
        lastIndexedBlock: log.blockNumber!,
      },
      // Reconcile config fields on rows that already exist (e.g. written by
      // the API's fast-path before the indexer reached this block). These all
      // come from the same immutable CircleCreated event, so this is the
      // authoritative correction pass — with update:{} a partial row would
      // keep stale values forever. lastIndexedBlock is deliberately NOT
      // touched: it belongs to the per-circle event scan, not discovery.
      update: {
        factoryTx: log.transactionHash!,
        creator: (a.creator ?? '0x').toLowerCase(),
        seats: Number(a.seats ?? 0n),
        contribution: (a.contribution ?? 0n).toString(),
        bond: (a.bond ?? 0n).toString(),
        mode: MODE_BY_ORDINAL[Number(a.mode ?? 0)] ?? 'LUCKY_DRAW',
        createdAt: new Date(Number(block.timestamp) * 1000),
      },
    });
  }
  return logs.length;
}

/**
 * Pull a circle's on-chain state and its new events into Postgres.
 *
 * Live state (state/currentRound) is read directly from the contract rather
 * than derived by replaying events — the contract is the source of truth, and
 * a direct read can't drift if an event is ever missed.
 */
export async function syncCircle(
  client: PublicClient,
  address: string,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<number> {
  const addr = address as `0x${string}`;

  const [stateVal, roundVal] = await Promise.all([
    client.readContract({ address: addr, abi: circleAbi as never, functionName: 'state' }) as Promise<number>,
    client.readContract({ address: addr, abi: circleAbi as never, functionName: 'currentRound' }) as Promise<bigint>,
  ]);

  const events = await getCircleEventsChunked(client, addr, fromBlock, toBlock);

  for (const ev of events) {
    // Idempotent on (txHash, logIndex) — a restart mid-scan can never duplicate.
    await prisma.chainEvent.upsert({
      where: { txHash_logIndex: { txHash: ev.transactionHash, logIndex: ev.logIndex } },
      create: {
        circleAddress: address.toLowerCase(),
        blockNumber: ev.blockNumber,
        txHash: ev.transactionHash,
        logIndex: ev.logIndex,
        eventName: ev.name,
        payload: serializeArgs(ev.args),
      },
      update: {},
    });

    // (txHash, logIndex) uniquely identifies this event; used as the notify
    // jobId so a re-scan of the same block can't send a duplicate message.
    await applyEvent(address.toLowerCase(), ev.name, ev.args, `${ev.transactionHash}:${ev.logIndex}`);
  }

  await prisma.circle.update({
    where: { address: address.toLowerCase() },
    data: {
      state: STATE_BY_ORDINAL[Number(stateVal)] ?? 'FILLING',
      currentRound: Number(roundVal),
      lastIndexedBlock: toBlock,
    },
  });

  return events.length;
}

/** BigInts aren't JSON-serialisable; store them as strings in the payload. */
function serializeArgs(args: Record<string, unknown>): Prisma.InputJsonValue {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    out[k] = typeof v === 'bigint' ? v.toString() : v;
  }
  return out as Prisma.InputJsonValue;
}

/** Circle.sol's COMMIT_WINDOW / REVEAL_WINDOW are both 1 day. */
const COMMIT_WINDOW_MS = 24 * 3600 * 1000;
/** Warn this long before a deadline. */
const REMINDER_LEAD_MS = 6 * 3600 * 1000;

/**
 * Look up a member's contact details and enqueue a message.
 *
 * Contact info only exists for people who signed up via the waitlist, so this
 * is best-effort: an on-chain member we have no email for is skipped silently
 * rather than treated as an error. Notifications are a courtesy, never a
 * dependency of the protocol.
 */
async function notifyMember(
  address: string,
  kind: NotifyKind,
  vars: Record<string, string | number>,
  dedupeId?: string,
  delayMs?: number,
) {
  try {
    const contact = await prisma.waitlistEntry.findFirst({
      where: { walletAddress: { equals: address, mode: 'insensitive' } },
      select: { email: true, whatsapp: true },
    });
    if (!contact) return;
    await enqueueNotify(
      { kind, email: contact.email, whatsapp: contact.whatsapp ?? undefined, userAddress: address, vars },
      dedupeId ? `${kind}:${dedupeId}` : undefined,
      delayMs,
    );
  } catch (err) {
    // Never let a notification failure break indexing — chain state is the job.
    logger.error({ err, address, kind }, 'failed to enqueue notification');
  }
}

/**
 * Schedule "your deadline is in ~6h" reminders for a round, as BullMQ *delayed*
 * jobs rather than a polling loop — the queue fires them at the right moment
 * and survives a worker restart.
 *
 * Fires for every joined member: the contract slashes anyone who doesn't reveal,
 * so the warning is exactly what protects their bond.
 */
async function scheduleDeadlineReminders(
  circleAddress: string,
  round: number,
  startedAt: Date,
  dedupeId?: string,
) {
  try {
    const members = await prisma.member.findMany({
      where: { circleAddress, slashed: false },
      select: { address: true },
    });
    // COMMIT closes ~1 day after the round starts; remind 6h before that.
    const delay = startedAt.getTime() + COMMIT_WINDOW_MS - REMINDER_LEAD_MS - Date.now();
    if (delay <= 0) return; // Indexing a historical round — the moment has passed.

    for (const m of members) {
      await notifyMember(
        m.address,
        'round_deadline_reminder',
        { circle: circleAddress, round, phase: 'COMMIT', hoursLeft: 6 },
        dedupeId ? `${dedupeId}:${m.address}` : undefined,
        delay, // delayed job — BullMQ fires it 6h before the deadline
      );
    }
  } catch (err) {
    logger.error({ err, circleAddress, round }, 'failed to schedule reminders');
  }
}

/**
 * Project an event onto the derived Member/Round rows, and enqueue any member
 * notification it implies.
 *
 * `dedupeId` is the event's (txHash, logIndex) — passed to BullMQ as the jobId
 * so a re-indexed block can't send the same message twice. The indexer
 * deliberately re-scans overlapping ranges on restart, so this matters.
 */
async function applyEvent(
  circleAddress: string,
  name: string,
  args: Record<string, unknown>,
  dedupeId?: string,
) {
  const str = (v: unknown) => (typeof v === 'string' ? v.toLowerCase() : undefined);

  switch (name) {
    case 'Joined': {
      const member = str(args.member);
      if (!member) return;
      await prisma.member.upsert({
        where: { circleAddress_address: { circleAddress, address: member } },
        create: { circleAddress, address: member, joinedAt: new Date() },
        update: {},
      });
      return;
    }
    case 'WinnerDrawn': {
      const winner = str(args.winner);
      const round = Number(args.round ?? 0);
      if (winner) {
        await prisma.member.updateMany({
          where: { circleAddress, address: winner },
          data: { hasWon: true },
        });
      }
      await prisma.round.upsert({
        where: { circleAddress_roundNumber: { circleAddress, roundNumber: round } },
        create: { circleAddress, roundNumber: round, phase: 'DRAW', winner: winner ?? null },
        update: { winner: winner ?? null },
      });
      if (winner) {
        // Flag the winner's bid row for this round so the history table can mark it.
        await prisma.roundBid.updateMany({
          where: { circleAddress, roundNumber: round, member: winner },
          data: { won: true },
        });
      }
      if (winner) await notifyMember(winner, 'payout_received', { circle: circleAddress, round }, dedupeId);
      return;
    }
    case 'Revealed': {
      const member = str(args.member);
      const round = Number(args.round ?? 0);
      const bid = String(args.bid ?? 0);
      if (!member) return;
      await prisma.roundBid.upsert({
        where: {
          circleAddress_roundNumber_member: {
            circleAddress, roundNumber: round, member,
          },
        },
        create: { circleAddress, roundNumber: round, member, bid, revealedAt: new Date() },
        update: { bid },
      });
      return;
    }
    case 'Slashed': {
      const member = str(args.defaulter) ?? str(args.member);
      if (member) {
        await prisma.member.updateMany({
          where: { circleAddress, address: member },
          data: { slashed: true },
        });
        await notifyMember(
          member,
          'slash_notice',
          { circle: circleAddress, amount: String(args.bondSlashed ?? 0) },
          dedupeId,
        );
      }
      return;
    }
    case 'RoundStarted': {
      const round = Number(args.round ?? 0);
      const startedAt = new Date();
      await prisma.round.upsert({
        where: { circleAddress_roundNumber: { circleAddress, roundNumber: round } },
        create: { circleAddress, roundNumber: round, phase: 'COMMIT', startedAt },
        update: { phase: 'COMMIT' },
      });
      await scheduleDeadlineReminders(circleAddress, round, startedAt, dedupeId);
      return;
    }
    case 'DrawRequested': {
      const round = Number(args.round ?? 0);
      await prisma.round.upsert({
        where: { circleAddress_roundNumber: { circleAddress, roundNumber: round } },
        create: { circleAddress, roundNumber: round, phase: 'DRAW', drawRequestedAt: new Date() },
        update: { phase: 'DRAW', drawRequestedAt: new Date() },
      });
      return;
    }
    default:
      // Committed/Revealed/Claimed/etc. are captured in ChainEvent; no derived
      // row to maintain for them today.
      logger.debug({ name }, 'event stored, no projection');
  }
}
