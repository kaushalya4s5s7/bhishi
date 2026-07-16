'use client';
import Link from 'next/link';
import { useState } from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';

function truncate(addr: string) {
  return addr.slice(0, 6) + '...' + addr.slice(-4);
}

const LINKS = [
  { href: '/#how', label: 'How it works' },
  { href: '/#trust', label: 'Trust' },
  { href: '/demo', label: 'Demo' },
];

export function Navbar() {
  const { ready, authenticated, login, logout } = usePrivy();
  const { wallets } = useWallets();
  const [open, setOpen] = useState(false);
  const embeddedWallet = wallets.find(w => w.walletClientType === 'privy');
  const address = embeddedWallet?.address;

  return (
    <nav className="sticky top-0 z-[100] w-full bg-[#faf9f6] border-b border-black/10 isolate">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/" className="font-display font-semibold text-base tracking-[0.08em] uppercase text-[#0b0b0e]">
          Bhishi<span className="text-[#c9a15c]">.</span>
        </Link>

        <div className="hidden md:flex items-center gap-8">
          {LINKS.map(l => (
            <a key={l.href} href={l.href} className="text-sm text-[#0b0b0e]/60 hover:text-[#0b0b0e] transition">
              {l.label}
            </a>
          ))}
        </div>

        <div className="hidden md:flex items-center gap-3">
          {!ready ? (
            <div className="w-24 h-9 bg-black/5 animate-pulse" />
          ) : authenticated ? (
            <>
              <span className="font-mono text-xs text-[#0b0b0e]/70 bg-black/5 border border-black/10 px-3 py-1.5">
                {address ? truncate(address) : 'Connected'}
              </span>
              <button
                type="button"
                onClick={() => logout()}
                className="text-sm text-[#0b0b0e]/60 hover:text-[#0b0b0e] px-3 py-1.5 border border-black/10 hover:border-black/25 transition"
              >
                Sign out
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => login()}
              className="bg-[#0b0b0e] text-white hover:bg-[#232127] text-sm font-semibold px-5 py-2 transition cursor-pointer"
            >
              Sign in
            </button>
          )}
        </div>

        <button
          type="button"
          aria-label="Toggle menu"
          onClick={() => setOpen(v => !v)}
          className="md:hidden text-[#0b0b0e] w-9 h-9 flex items-center justify-center"
        >
          <span className="sr-only">Menu</span>
          <div className="flex flex-col gap-1.5">
            <span className={`block w-5 h-[1.5px] bg-[#0b0b0e] transition ${open ? 'rotate-45 translate-y-[6px]' : ''}`} />
            <span className={`block w-5 h-[1.5px] bg-[#0b0b0e] transition ${open ? 'opacity-0' : ''}`} />
            <span className={`block w-5 h-[1.5px] bg-[#0b0b0e] transition ${open ? '-rotate-45 -translate-y-[6px]' : ''}`} />
          </div>
        </button>
      </div>

      {open && (
        <div className="md:hidden border-t border-black/10 bg-[#faf9f6] px-6 py-5 flex flex-col gap-4">
          {LINKS.map(l => (
            <a key={l.href} href={l.href} onClick={() => setOpen(false)} className="text-sm text-[#0b0b0e]/60 hover:text-[#0b0b0e] transition">
              {l.label}
            </a>
          ))}
          <div className="pt-2 border-t border-black/10">
            {!ready ? null : authenticated ? (
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-[#0b0b0e]/70">{address ? truncate(address) : 'Connected'}</span>
                <button type="button" onClick={() => logout()} className="text-sm text-[#0b0b0e]/60 hover:text-[#0b0b0e]">
                  Sign out
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => login()}
                className="w-full bg-[#0b0b0e] text-white font-semibold px-5 py-2.5"
              >
                Sign in
              </button>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}
