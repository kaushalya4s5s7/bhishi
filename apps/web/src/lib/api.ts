/**
 * Base URL of the NestJS API (apps/api). It owns all off-chain persistence —
 * waitlist entries, user profiles — behind the /api prefix. The browser talks to
 * it directly (CORS is enabled server-side), so this must be an absolute origin,
 * NOT the Next.js app's own /api routes.
 *
 * Defaults to the local API port so `pnpm dev` works with no extra config.
 */
export const API_BASE = (
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'
).replace(/\/$/, '');

/** Build a full API URL for a path like `/api/waitlist`. */
export function apiUrl(path: string): string {
  return `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
}
