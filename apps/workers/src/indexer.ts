import { prisma } from '@bhishi/db';
import { config, logger, publicClient } from './config.js';
import { syncCircle, syncFactory } from './indexer/sync.js';

const CURSOR_ID = 'factory';

/**
 * Cap on how many blocks one tick may cover. Without this, a fresh deploy that
 * is hundreds of thousands of blocks behind head tries the ENTIRE gap in one
 * tick — thousands of sequential 100-block getLogs calls — and the cursor is
 * only written after the whole span succeeds. One rate-limit error anywhere
 * throws the tick away, the cursor never moves, and the next tick restarts the
 * same full span from scratch: the indexer can be behind forever. Bounding the
 * span makes every tick's progress durable (~50 RPC calls per tick at Monad's
 * 100-block getLogs limit).
 */
const MAX_BLOCKS_PER_TICK = 5_000n;

/**
 * Indexer worker: keeps Postgres in sync with chain state.
 *
 * Poll-based rather than a websocket subscription: it needs an exact,
 * persisted block cursor so a crash/restart resumes without gaps or
 * duplicates, and getLogs polling is what survives RPC flakiness. Postgres is
 * a rebuildable cache — deleting the cursor replays from START_BLOCK.
 *
 * Returns true when there are more blocks waiting beyond this tick's window,
 * so the main loop can catch up without sleeping between windows.
 */
async function tick(): Promise<boolean> {
  const head = await publicClient.getBlockNumber();

  const cursor = await prisma.indexerCursor.upsert({
    where: { id: CURSOR_ID },
    create: { id: CURSOR_ID, lastIndexedBlock: config.startBlock },
    update: {},
  });

  const from = cursor.lastIndexedBlock > 0n ? cursor.lastIndexedBlock + 1n : config.startBlock;
  if (from > head) {
    logger.debug({ from, head }, 'up to date');
    return false;
  }

  // Bound this tick's window; the cursor advances to the window end, so a
  // failure in a later window never discards earlier windows' progress.
  const to = from + MAX_BLOCKS_PER_TICK - 1n < head ? from + MAX_BLOCKS_PER_TICK - 1n : head;

  const created = await syncFactory(publicClient, config.factory, from, to);
  if (created > 0) logger.info({ created, from, to }, 'discovered new circles');

  // Sync every circle that isn't finished. Completed/aborted circles are
  // terminal on-chain, so there's nothing left to observe.
  const circles = await prisma.circle.findMany({
    where: { state: { notIn: ['COMPLETED', 'ABORTED_FILLING'] } },
    select: { address: true, lastIndexedBlock: true },
  });

  for (const c of circles) {
    const cFrom = c.lastIndexedBlock > 0n ? c.lastIndexedBlock + 1n : config.startBlock;
    if (cFrom > to) continue;
    // Same span cap per circle: a circle row fast-pathed in with
    // lastIndexedBlock=0 would otherwise try startBlock→head in one shot.
    const cTo = cFrom + MAX_BLOCKS_PER_TICK - 1n < to ? cFrom + MAX_BLOCKS_PER_TICK - 1n : to;
    try {
      const n = await syncCircle(publicClient, c.address, cFrom, cTo);
      if (n > 0) logger.info({ circle: c.address, events: n }, 'indexed circle events');
    } catch (err) {
      // Don't let one bad circle stall the whole loop; its cursor stays put so
      // the next tick retries the same range.
      logger.error({ err, circle: c.address }, 'failed to sync circle');
    }
  }

  await prisma.indexerCursor.update({
    where: { id: CURSOR_ID },
    data: { lastIndexedBlock: to },
  });

  return to < head;
}

async function main() {
  logger.info(
    { factory: config.factory, rpc: config.rpcUrl, startBlock: config.startBlock },
    'indexer starting',
  );

  let stopping = false;
  const shutdown = async (sig: string) => {
    logger.info({ sig }, 'shutting down');
    stopping = true;
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // Run once immediately, then on an interval. While catching up (tick's
  // window ended short of head) use a short breather instead of the full poll
  // interval, so a large backlog drains quickly without hammering the RPC.
  for (;;) {
    if (stopping) return;
    let behind = false;
    try {
      behind = await tick();
    } catch (err) {
      logger.error({ err }, 'tick failed; will retry');
    }
    await new Promise((r) => setTimeout(r, behind ? 1_000 : config.pollIntervalMs));
  }
}

// Only run when executed directly, so tests can import the module.
if (process.env.NODE_ENV !== 'test') {
  void main();
}

export { tick };
