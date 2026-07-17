'use client';
import { usePrivy } from '@privy-io/react-auth';
import type { ReactNode } from 'react';
import { Button, Eyebrow, Seal, LedgerRule } from '@/components/ui';

/**
 * Wraps any protected screen. Shows a branded loading, then a branded sign-in
 * invitation, then the children once authenticated. Every gated page uses this
 * so the entry moment is identical across the app.
 */
export function AuthGate({
  children,
  title = 'Sign in to continue',
  blurb = 'One tap with email or Google. We create a secure wallet for you — no seed phrase, no extension.',
}: {
  children: ReactNode;
  title?: string;
  blurb?: string;
}) {
  const { ready, authenticated, login } = usePrivy();

  if (!ready) {
    return (
      <div className="min-h-[70vh] grid place-items-center">
        <div className="flex items-center gap-3 text-[#6b6470]">
          <span className="h-4 w-4 rounded-full border-2 border-[#c9a15c] border-t-transparent animate-spin" />
          <span className="font-mono text-xs tracking-[0.2em] uppercase">Loading</span>
        </div>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="min-h-[80vh] grid place-items-center px-6">
        <div className="w-full max-w-md text-center">
          <div className="flex justify-center mb-8"><Seal size={52} /></div>
          <Eyebrow>Bhishi &middot; Monad testnet</Eyebrow>
          <h1 className="font-display font-semibold text-4xl sm:text-5xl leading-[1.05] mt-4 text-balance">
            {title}
          </h1>
          <p className="mt-5 text-[#6b6470] leading-relaxed">{blurb}</p>
          <div className="mt-8">
            <Button onClick={() => login()} full>Sign in</Button>
          </div>
          <LedgerRule className="mt-10" />
          <p className="mt-6 font-mono text-[11px] tracking-[0.15em] uppercase text-[#6b6470]">
            Non-custodial &middot; you hold the keys
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
