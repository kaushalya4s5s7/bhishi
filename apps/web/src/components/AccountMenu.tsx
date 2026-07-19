'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePrivy } from '@privy-io/react-auth';
import { useMember } from '@/lib/member';
import { useProfile } from '@/lib/profile';
import { Avatar, truncate } from '@/components/ui';

/**
 * Avatar button + dropdown shown in place of the raw address/sign-out pair
 * once a user is authenticated. Shared by both navbar variants (the app's
 * rounded nav and the landing page's ledger nav) so the menu itself always
 * looks and behaves the same regardless of which shell it's opened from.
 */
export function AccountMenu() {
  const { logout } = usePrivy();
  const { address } = useMember();
  const { profile } = useProfile();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const [copied, setCopied] = useState(false);
  const copyAddress = async () => {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const name = profile?.displayName || profile?.email || (address ? truncate(address) : 'Account');

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-label="Account menu"
        aria-expanded={open}
        className="w-9 h-9 rounded-full overflow-hidden shrink-0 ring-2 ring-transparent hover:ring-[#c9a15c]/40 transition"
      >
        {address ? <Avatar seed={address} avatarUrl={profile?.avatarUrl} size={36} /> : (
          <span className="w-9 h-9 grid place-items-center rounded-full bg-[#f6f4ee] text-[#6b6470] text-sm">…</span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-3 w-64 bg-white rounded-2xl shadow-xl p-2 z-[110] origin-top-right animate-[fadeIn_0.12s_ease-out]">
          <div className="flex items-center gap-3 px-3 py-3">
            {address && <Avatar seed={address} avatarUrl={profile?.avatarUrl} size={40} />}
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[#0b0b0e] truncate">{name}</p>
              <p className="text-xs text-[#6b6470]">Monad testnet</p>
            </div>
          </div>

          <button
            type="button"
            onClick={copyAddress}
            className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl text-sm text-[#6b6470] hover:bg-[#f6f4ee] hover:text-[#0b0b0e] transition"
          >
            <span className="font-mono text-xs">{address ? truncate(address) : 'Resolving…'}</span>
            <span className="text-xs shrink-0">{copied ? 'Copied' : 'Copy'}</span>
          </button>

          <div className="h-px bg-[#f0ede4] my-1.5" />

          <Link
            href="/profile"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm text-[#0b0b0e] hover:bg-[#f6f4ee] transition"
          >
            Profile
          </Link>

          <div className="h-px bg-[#f0ede4] my-1.5" />

          <button
            type="button"
            onClick={() => logout()}
            className="w-full text-left px-3 py-2.5 rounded-xl text-sm text-[#9a4a3a] hover:bg-[#f3e3e0] transition"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
