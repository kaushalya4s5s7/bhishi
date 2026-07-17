import type { PublicClient } from 'viem';
import { parseAbiItem } from 'viem';
import { circleAbi } from '@bhishi/shared';
import { getCircleEventsChunked, DEFAULT_CHUNK_SIZE } from '@bhishi/events';
import { prisma, Prisma, type CircleMode, type CircleState } from '@bhishi/db';
import { logger } from '../config.js';

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
      update: {},
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

    await applyEvent(address.toLowerCase(), ev.name, ev.args);
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

/** Project an event onto the derived Member/Round rows. */
async function applyEvent(circleAddress: string, name: string, args: Record<string, unknown>) {
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
      return;
    }
    case 'Slashed': {
      const member = str(args.defaulter) ?? str(args.member);
      if (member) {
        await prisma.member.updateMany({
          where: { circleAddress, address: member },
          data: { slashed: true },
        });
      }
      return;
    }
    case 'RoundStarted': {
      const round = Number(args.round ?? 0);
      await prisma.round.upsert({
        where: { circleAddress_roundNumber: { circleAddress, roundNumber: round } },
        create: { circleAddress, roundNumber: round, phase: 'COMMIT', startedAt: new Date() },
        update: { phase: 'COMMIT' },
      });
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
