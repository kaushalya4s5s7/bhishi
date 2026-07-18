import type { PublicClient } from 'viem';
export type CircleEventName = 'Joined' | 'Activated' | 'FillingRefunded' | 'RoundStarted' | 'Committed' | 'Revealed' | 'DrawRequested' | 'DrawReady' | 'WinnerDrawn' | 'Slashed' | 'Stalled' | 'Claimed';
export type CircleEvent = {
    name: CircleEventName;
    blockNumber: bigint;
    transactionHash: `0x${string}`;
    args: Record<string, unknown>;
    logIndex: number;
};
export declare function getCircleEvents(client: PublicClient, circleAddress: `0x${string}`, fromBlock?: bigint, toBlock?: bigint | 'latest'): Promise<CircleEvent[]>;
/**
 * Default span per getLogs call.
 *
 * Public RPCs cap the block range they will scan, so backfills must be chunked
 * rather than asking for genesis..latest in one shot. 100 is not arbitrary:
 * Monad's public testnet RPC rejects anything wider with
 * "eth_getLogs is limited to a 100 range" (error -32614). Override via
 * LOG_CHUNK_SIZE for providers with a more generous cap.
 */
export declare const DEFAULT_CHUNK_SIZE = 100n;
/**
 * Range-scan a circle's events in bounded chunks, so a backfill over a large
 * block span works against rate-limited/capped public RPCs. Results are
 * returned in (blockNumber, logIndex) order across all chunks.
 */
export declare function getCircleEventsChunked(client: PublicClient, circleAddress: `0x${string}`, fromBlock: bigint, toBlock: bigint, chunkSize?: bigint): Promise<CircleEvent[]>;
/**
 * Subscribe to a circle's events. Implemented as a poll loop over getLogs
 * rather than viem's watchContractEvent: the indexer needs an exact, gap-free
 * (blockNumber, logIndex) cursor it can persist and resume from, and polling
 * getLogs is what survives an RPC reconnect or a worker restart. Returns an
 * unsubscribe function.
 */
export declare function watchCircleEvents(client: PublicClient, circleAddress: `0x${string}`, onEvent: (event: CircleEvent) => void, opts?: {
    fromBlock?: bigint;
    pollIntervalMs?: number;
}): () => void;
//# sourceMappingURL=watchers.d.ts.map