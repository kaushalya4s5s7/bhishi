'use client';
import { useProfile } from '@/lib/profile';

/**
 * Mount-only: runs useProfile() so the signed-in user's off-chain profile is
 * auto-provisioned (POST /profiles/me) the moment a wallet is available, on
 * every page. Renders nothing.
 */
export function ProfileSync() {
  useProfile();
  return null;
}
