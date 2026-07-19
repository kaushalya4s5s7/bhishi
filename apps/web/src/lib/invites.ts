import { apiUrl } from './api';

export interface ValidateResult {
  valid: boolean;
  circleAddress?: string;
  kind?: 'LINK' | 'EMAIL';
  status?: string;
  reason?: 'unknown' | 'revoked' | 'full';
}

export interface CreateInvitesResult {
  linkUrl: string;
  invited: { email: string; url: string }[];
  /** Emails whose invite token was minted but the email itself failed to send
   *  (e.g. provider rejected the sender/recipient) — link still works. */
  failed: string[];
}

/** Mint the reusable link + email tokens for a circle. Requires an auth token. */
export async function createInvites(
  token: string | null,
  circleAddress: string,
  emails: string[],
): Promise<CreateInvitesResult> {
  const res = await fetch(apiUrl('/api/invites'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ circleAddress, emails }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    // Always include the status so callers can branch on it (e.g. 409 = a
    // retryable indexing race vs 403 = genuine non-creator) even when the API
    // also provides a human message.
    const detail = body?.message ? `${body.message} (${res.status})` : `Invite failed (${res.status})`;
    throw new Error(detail);
  }
  return res.json();
}

/** Public token resolution for the invite-gated landing. */
export async function validateInvite(inviteToken: string): Promise<ValidateResult> {
  const res = await fetch(apiUrl(`/api/invites/${inviteToken}`));
  if (!res.ok) return { valid: false, reason: 'unknown' };
  return res.json();
}

/** Best-effort attribution after a successful join. Never throw to the caller. */
export async function consumeInvite(token: string | null, inviteToken: string): Promise<void> {
  try {
    await fetch(apiUrl(`/api/invites/${inviteToken}/consume`), {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  } catch {
    /* attribution is non-critical */
  }
}

/** Split a free-text email field on commas/whitespace/newlines into clean addrs. */
export function parseEmails(input: string): string[] {
  return Array.from(
    new Set(
      input
        .split(/[\s,;]+/)
        .map(s => s.trim().toLowerCase())
        .filter(s => s.includes('@')),
    ),
  );
}
