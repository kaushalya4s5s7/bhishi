import type { PublicClient, Log } from 'viem';
import { parseEventLogs } from 'viem';
import { circleAbi } from '@bhishi/shared';

// Mirrors the Circle.sol event set exactly (see packages/shared abis/Circle.json).
export type CircleEventName =
  | 'Joined' | 'Activated' | 'FillingRefunded'
  | 'RoundStarted' | 'Committed' | 'Revealed'
  | 'DrawRequested' | 'DrawReady' | 'WinnerDrawn'
  | 'Slashed' | 'Stalled' | 'Claimed';

export type CircleEvent = {
  name: CircleEventName;
  blockNumber: bigint;
  transactionHash: `0x${string}`;
  args: Record<string, unknown>;
  logIndex: number;
};

type AnyLog = Log & { eventName?: string; args?: unknown };

export async function getCircleEvents(
  client: PublicClient,
  circleAddress: `0x${string}`,
  fromBlock?: bigint,
  toBlock?: bigint | 'latest',
): Promise<CircleEvent[]> {
  // Fetch raw (undecoded) logs, then decode via parseEventLogs — NOT
  // getLogs({ abi }), whose auto-decode silently leaves `eventName`/`args`
  // undefined for logs it fails to match/decode internally (a real viem
  // quirk: manually calling decodeEventLog on the exact same log succeeds).
  // That silent failure meant every Circle event (Joined, Committed, etc.)
  // was indexed with an empty name and args, so nothing ever reached
  // applyEvent()'s switch — members who joined on-chain never got a Member
  // row and vanished from "my circles".
  const rawLogs = await client.getLogs({
    address: circleAddress,
    fromBlock: fromBlock ?? 0n,
    toBlock: toBlock ?? 'latest',
  });
  const logs = parseEventLogs({ abi: circleAbi, logs: rawLogs }) as unknown as AnyLog[];

  return logs
    .map((log) => ({
      name: (log.eventName ?? '') as CircleEventName,
      blockNumber: log.blockNumber ?? 0n,
      transactionHash: log.transactionHash ?? ('0x' as `0x${string}`),
      args: (log.args ?? {}) as Record<string, unknown>,
      logIndex: log.logIndex ?? 0,
    }))
    .sort((a, b) =>
      a.blockNumber !== b.blockNumber
        ? Number(a.blockNumber - b.blockNumber)
        : a.logIndex - b.logIndex,
    );
}

/**
 * Default span per getLogs call.
 *
 * Public RPCs cap the block range they will scan, so backfills must be chunked
 * rather than asking for genesis..latest in one shot. 100 is not arbitrary:
 * Monad's public testnet RPC rejects anything wider with
 * "eth_getLogs is limited to a 100 range" (error -32614). Override via
 * LOG_CHUNK_SIZE for providers with a more generous cap.
 */
export const DEFAULT_CHUNK_SIZE = 100n;

/**
 * Range-scan a circle's events in bounded chunks, so a backfill over a large
 * block span works against rate-limited/capped public RPCs. Results are
 * returned in (blockNumber, logIndex) order across all chunks.
 */
export async function getCircleEventsChunked(
  client: PublicClient,
  circleAddress: `0x${string}`,
  fromBlock: bigint,
  toBlock: bigint,
  chunkSize: bigint = DEFAULT_CHUNK_SIZE,
): Promise<CircleEvent[]> {
  if (toBlock < fromBlock) return [];
  const out: CircleEvent[] = [];
  for (let start = fromBlock; start <= toBlock; start += chunkSize) {
    const end = start + chunkSize - 1n > toBlock ? toBlock : start + chunkSize - 1n;
    out.push(...(await getCircleEvents(client, circleAddress, start, end)));
  }
  return out;
}

/**
 * Subscribe to a circle's events. Implemented as a poll loop over getLogs
 * rather than viem's watchContractEvent: the indexer needs an exact, gap-free
 * (blockNumber, logIndex) cursor it can persist and resume from, and polling
 * getLogs is what survives an RPC reconnect or a worker restart. Returns an
 * unsubscribe function.
 */
export function watchCircleEvents(
  client: PublicClient,
  circleAddress: `0x${string}`,
  onEvent: (event: CircleEvent) => void,
  opts: { fromBlock?: bigint; pollIntervalMs?: number } = {},
): () => void {
  const pollIntervalMs = opts.pollIntervalMs ?? 5_000;
  let cursor = opts.fromBlock;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const tick = async () => {
    if (stopped) return;
    try {
      const head = await client.getBlockNumber();
      if (cursor === undefined) cursor = head; // default: only new events
      if (head >= cursor) {
        const events = await getCircleEventsChunked(client, circleAddress, cursor, head);
        for (const e of events) {
          if (stopped) return;
          onEvent(e);
        }
        cursor = head + 1n;
      }
    } catch {
      // Swallow transient RPC errors; the next tick retries from the same
      // cursor, so nothing is skipped.
    } finally {
      if (!stopped) timer = setTimeout(tick, pollIntervalMs);
    }
  };

  void tick();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
