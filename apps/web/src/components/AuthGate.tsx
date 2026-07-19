'use client';
import { usePrivy } from '@privy-io/react-auth';
import type { ReactNode } from 'react';
import { Eyebrow, Seal } from '@/components/ui';

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
      <div className="min-h-[80vh] grid place-items-center px-4 sm:px-6 py-10">
        <div className="w-full max-w-md rounded-[32px] shadow-sm p-10 sm:p-12 text-center relative overflow-hidden" style={{ background: 'linear-gradient(160deg, #f6e3d5, #e4e9fb 55%, #dcefe8)' }}>
          {/* Soft orbiting accents echoing the dashboard's gradient stat cards */}
          <div className="pointer-events-none absolute -top-10 -left-10 w-40 h-40 rounded-full bg-white/40 blur-2xl" aria-hidden />
          <div className="pointer-events-none absolute -bottom-12 -right-8 w-44 h-44 rounded-full bg-white/30 blur-2xl" aria-hidden />

          <div className="relative">
            <div className="flex justify-center mb-6">
              <div className="w-16 h-16 rounded-full bg-white shadow-sm grid place-items-center">
                <Seal size={40} />
              </div>
            </div>
            <Eyebrow>Bhishi &middot; Monad testnet</Eyebrow>
            <h1 className="font-display font-semibold text-3xl sm:text-4xl leading-[1.1] mt-4 text-balance text-[#0b0b0e]">
              {title}
            </h1>
            <p className="mt-4 text-[#0b0b0e]/70 leading-relaxed text-sm sm:text-base">{blurb}</p>
            <div className="mt-8">
              <button
                onClick={() => login()}
                className="w-full bg-[#0b0b0e] text-white hover:bg-[#232127] font-semibold rounded-full px-6 py-3.5 transition-colors"
              >
                Sign in
              </button>
            </div>
            <div className="mt-7 inline-flex items-center gap-2 bg-white/60 rounded-full px-4 py-1.5">
              <span className="font-mono text-[11px] tracking-[0.15em] uppercase text-[#0b0b0e]/70">
                Non-custodial &middot; you hold the keys
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
