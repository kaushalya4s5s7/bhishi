import { describe, expect, it } from 'vitest';
import { getCircleEventsChunked, DEFAULT_CHUNK_SIZE } from '@bhishi/events';
import type { PublicClient } from 'viem';

/**
 * Monad's public RPC rejects any eth_getLogs wider than 100 blocks (-32614),
 * which took down the first indexer run. These tests pin the chunking contract
 * so that regression can't come back silently.
 */
describe('getLogs chunking', () => {
  it('defaults to a span the RPC will actually accept', () => {
    expect(DEFAULT_CHUNK_SIZE).toBeLessThanOrEqual(100n);
  });

  it('splits a wide range into chunks that never exceed the cap', async () => {
    const spans: Array<{ from: bigint; to: bigint }> = [];
    const fake = {
      getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
        spans.push({ from: fromBlock, to: toBlock });
        return [];
      },
    } as unknown as PublicClient;

    await getCircleEventsChunked(fake, '0xabc', 1000n, 1450n, 100n);

    expect(spans.length).toBe(5);
    for (const s of spans) {
      expect(s.to - s.from + 1n).toBeLessThanOrEqual(100n);
    }
    // Contiguous and complete: no gaps, no overlap, exact end.
    expect(spans[0].from).toBe(1000n);
    expect(spans.at(-1)!.to).toBe(1450n);
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i].from).toBe(spans[i - 1].to + 1n);
    }
  });

  it('returns nothing (and makes no call) when the range is empty', async () => {
    let called = 0;
    const fake = {
      getLogs: async () => {
        called++;
        return [];
      },
    } as unknown as PublicClient;

    const out = await getCircleEventsChunked(fake, '0xabc', 500n, 400n);
    expect(out).toEqual([]);
    expect(called).toBe(0);
  });
});
