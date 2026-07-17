import pino from 'pino';
import { createPublicClient, http, type PublicClient } from 'viem';
import { addresses } from '@bhishi/shared';

export const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const config = {
  rpcUrl: process.env.MONAD_RPC_URL ?? 'https://testnet-rpc.monad.xyz',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  factory: (process.env.FACTORY_ADDRESS ?? addresses.monadTestnet.factory) as `0x${string}`,
  /** Block to start indexing from — the factory's deploy block. */
  startBlock: BigInt(process.env.START_BLOCK ?? '0'),
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? 10_000),
  required,
};

export const monadTestnet = {
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [config.rpcUrl] } },
} as const;

// Explicit annotation: viem's inferred client type isn't portable across
// package boundaries (TS2742) without naming internal action modules.
export const publicClient: PublicClient = createPublicClient({
  chain: monadTestnet,
  transport: http(config.rpcUrl),
}) as PublicClient;
