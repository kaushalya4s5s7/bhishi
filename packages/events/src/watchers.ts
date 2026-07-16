import type { PublicClient, Log } from 'viem';
import { circleAbi } from '@bhishi/shared';

export type CircleEventName =
  | 'Joined' | 'Activated' | 'FillingRefunded'
  | 'RoundStarted' | 'Committed' | 'Revealed'
  | 'DrawRequested' | 'WinnerDrawn' | 'Slashed'
  | 'Stalled' | 'DrawReady';

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
  // Cast through unknown because circleAbi is typed as Abi (not a const-narrowed tuple),
  // so viem cannot statically infer the event union. At runtime the ABI is complete.
  const logs = (await (client.getLogs as Function)({
    address: circleAddress,
    abi: circleAbi,
    fromBlock: fromBlock ?? 0n,
    toBlock: toBlock ?? 'latest',
  })) as AnyLog[];

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

export function watchCircleEvents(
  client: PublicClient,
  circleAddress: `0x${string}`,
  onEvent: (event: CircleEvent) => void,
): () => void {
  // TODO: implement viem watchContractEvent wrapper
  return () => {};
}
