import { PrismaClient } from '@prisma/client';

/**
 * Shared Prisma client. A single instance is reused across the process (and
 * cached on globalThis in dev) so hot-reload doesn't exhaust the connection
 * pool by minting a new client per reload.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['warn', 'error'] : ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export * from '@prisma/client';
