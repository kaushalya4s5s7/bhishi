import { apiUrl } from './api';

export type ConfirmableAction = 'join' | 'commit' | 'reveal' | 'createCircle';

/**
 * Fast-path notification: tell the backend a transaction the CURRENT user just
 * sent has confirmed, so it can independently verify the receipt (via its own
 * RPC call — nothing here is trusted) and update Postgres immediately, instead
 * of the caller waiting for the indexer's next poll to notice. Best-effort and
 * non-blocking: the indexer still reconciles the same data on its own
 * schedule, so a failure here (network blip, RPC hiccup) only costs a little
 * UI latency, never correctness. Never await this where it could block or
 * surface an error to the user — call it and move on.
 */
export function confirmTransaction(token: string | null, txHash: `0x${string}`, action: ConfirmableAction): void {
  fetch(apiUrl('/api/transactions/confirm'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ txHash, action }),
  }).catch(() => {
    // Best-effort only — the indexer will pick this up on its next pass.
  });
}
