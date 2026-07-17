import { prisma } from '@bhishi/db';
import { config, logger, publicClient } from './config.js';
import { syncCircle, syncFactory } from './indexer/sync.js';

const CURSOR_ID = 'factory';

/**
 * Indexer worker: keeps Postgres in sync with chain state.
 *
 * Poll-based rather than a websocket subscription: it needs an exact,
 * persisted block cursor so a crash/restart resumes without gaps or
 * duplicates, and getLogs polling is what survives RPC flakiness. Postgres is
 * a rebuildable cache — deleting the cursor replays from START_BLOCK.
 */
async function tick() {
  const head = await publicClient.getBlockNumber();

  const cursor = await prisma.indexerCursor.upsert({
    where: { id: CURSOR_ID },
    create: { id: CURSOR_ID, lastIndexedBlock: config.startBlock },
    update: {},
  });

  const from = cursor.lastIndexedBlock > 0n ? cursor.lastIndexedBlock + 1n : config.startBlock;
  if (from > head) {
    logger.debug({ from, head }, 'up to date');
    return;
  }

  const created = await syncFactory(publicClient, config.factory, from, head);
  if (created > 0) logger.info({ created, from, head }, 'discovered new circles');

  // Sync every circle that isn't finished. Completed/aborted circles are
  // terminal on-chain, so there's nothing left to observe.
  const circles = await prisma.circle.findMany({
    where: { state: { notIn: ['COMPLETED', 'ABORTED_FILLING'] } },
    select: { address: true, lastIndexedBlock: true },
  });

  for (const c of circles) {
    const cFrom = c.lastIndexedBlock > 0n ? c.lastIndexedBlock + 1n : config.startBlock;
    if (cFrom > head) continue;
    try {
      const n = await syncCircle(publicClient, c.address, cFrom, head);
      if (n > 0) logger.info({ circle: c.address, events: n }, 'indexed circle events');
    } catch (err) {
      // Don't let one bad circle stall the whole loop; its cursor stays put so
      // the next tick retries the same range.
      logger.error({ err, circle: c.address }, 'failed to sync circle');
    }
  }

  await prisma.indexerCursor.update({
    where: { id: CURSOR_ID },
    data: { lastIndexedBlock: head },
  });
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

  // Run once immediately, then on an interval.
  for (;;) {
    if (stopping) return;
    try {
      await tick();
    } catch (err) {
      logger.error({ err }, 'tick failed; will retry');
    }
    await new Promise((r) => setTimeout(r, config.pollIntervalMs));
  }
}

// Only run when executed directly, so tests can import the module.
if (process.env.NODE_ENV !== 'test') {
  void main();
}

export { tick };
