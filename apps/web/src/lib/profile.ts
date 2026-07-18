'use client';
import { useCallback, useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { apiUrl } from './api';
import { useMember } from './member';

export interface UserProfile {
  walletAddress: string;
  privyUserId?: string | null;
  email?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string;
}

/** Public, unauthenticated lookup of any address's profile. Returns null if the
 *  address has no profile row yet (never signed in) or on any fetch error. */
export async function fetchProfile(address: string): Promise<UserProfile | null> {
  try {
    const res = await fetch(apiUrl(`/api/profiles/${address}`));
    if (!res.ok) return null;
    return (await res.json()) as UserProfile;
  } catch {
    return null;
  }
}

/** Best display label for a member: their displayName, else their email, else
 *  a truncated address. Never blank. */
export function memberLabel(profile: UserProfile | null | undefined, address: string): string {
  if (profile?.displayName) return profile.displayName;
  if (profile?.email) return profile.email;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * Auto-provisions the signed-in user's off-chain profile and exposes it for
 * reading/editing. On sign-in (once a wallet address exists) it POSTs
 * /profiles/me, which upserts the row server-side — so a profile always exists
 * for an authenticated user without any explicit "create profile" step.
 */
export function useProfile() {
  const { authenticated, getAccessToken } = usePrivy();
  const { address } = useMember();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const authFetch = useCallback(
    async (path: string, init: RequestInit = {}) => {
      const token = await getAccessToken();
      if (!token) throw new Error('Not signed in');
      return fetch(apiUrl(path), {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          ...(init.headers ?? {}),
        },
      });
    },
    [getAccessToken],
  );

  // Provision + load once we have both an auth session and a resolved wallet.
  useEffect(() => {
    if (!authenticated || !address) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await authFetch('/api/profiles/me', { method: 'POST' });
        if (!res.ok) throw new Error(`Profile provision failed (${res.status})`);
        const data = (await res.json()) as UserProfile;
        if (!cancelled) setProfile(data);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authenticated, address, authFetch]);

  const save = useCallback(
    async (patch: { displayName?: string; avatarUrl?: string }) => {
      setLoading(true);
      setError(null);
      try {
        const res = await authFetch('/api/profiles/me', {
          method: 'PATCH',
          body: JSON.stringify(patch),
        });
        if (!res.ok) throw new Error(`Save failed (${res.status})`);
        const data = (await res.json()) as UserProfile;
        setProfile(data);
        return data;
      } catch (e) {
        setError((e as Error).message);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [authFetch],
  );

  return { profile, loading, error, save };
}
