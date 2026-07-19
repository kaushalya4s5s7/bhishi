'use client';
import Link from 'next/link';
import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { useMember } from '@/lib/member';
import { AccountMenu } from '@/components/AccountMenu';

function truncate(addr: string) {
  return addr.slice(0, 6) + '...' + addr.slice(-4);
}

// The B mark: two unequal bowls sharing one spine — ink (paid in) balanced
// against brass (paid out). Matches public/logo-mark.svg.
function BhishiMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 72 72" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
      <rect x="18" y="10" width="7" height="52" fill="#0b0b0e" />
      <path d="M25 10 H38 A13 13 0 0 1 38 36 H25 Z" fill="#0b0b0e" />
      <path d="M25 36 H40 A13 13 0 0 1 40 62 H25 Z" fill="#c9a15c" />
    </svg>
  );
}

const GUEST_LINKS = [
  { href: '/#how', label: 'How it works' },
  { href: '/#trust', label: 'Trust' },
  { href: '/demo', label: 'Demo' },
];

const APP_LINKS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/faucet', label: 'Faucet' },
  { href: '/profile', label: 'Profile' },
];

const APP_ROUTES = ['/dashboard', '/faucet', '/profile', '/circle'];

export function Navbar() {
  const { ready, authenticated, login, logout } = usePrivy();
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  // Show the identity that actually holds funds and joins circles — not the
  // embedded signer behind it (see lib/member.ts).
  const { address } = useMember();
  // Signed-in users get the app nav; guests get the marketing nav.
  const LINKS = authenticated ? APP_LINKS : GUEST_LINKS;
  // The app screens (dashboard/faucet/profile/circle) get the soft, rounded
  // nav to match their gradient-card design; the landing page keeps its
  // original ledger-style navbar untouched (it overlays the hero image).
  const isAppRoute = APP_ROUTES.some(r => pathname?.startsWith(r));

  if (isAppRoute) {
    return (
      <nav className="sticky top-0 z-[100] w-full px-4 sm:px-6 pt-4">
        <div className="max-w-7xl mx-auto bg-white/80 backdrop-blur-md shadow-sm rounded-full px-5 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-display font-semibold text-base tracking-[0.08em] uppercase text-[#0b0b0e]">
            <BhishiMark size={22} />
            Bhishi<span className="text-[#c9a15c]">.</span>
          </Link>

          <div className="hidden md:flex items-center gap-6">
            {APP_LINKS.map(l => (
              <Link
                key={l.href}
                href={l.href}
                className={`text-sm transition rounded-full px-3 py-1.5 ${
                  pathname?.startsWith(l.href) ? 'bg-[#f0ede4] text-[#0b0b0e] font-medium' : 'text-[#6b6470] hover:text-[#0b0b0e]'
                }`}
              >
                {l.label}
              </Link>
            ))}
          </div>

          <div className="hidden md:flex items-center gap-3">
            {!ready ? (
              <div className="w-9 h-9 rounded-full bg-black/5 animate-pulse" />
            ) : authenticated ? (
              <AccountMenu />
            ) : (
              <button
                type="button"
                onClick={() => login()}
                className="bg-[#0b0b0e] text-white hover:bg-[#232127] text-sm font-semibold rounded-full px-5 py-2 transition cursor-pointer"
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
          <div className="md:hidden max-w-7xl mx-auto bg-white/95 backdrop-blur-md shadow-sm rounded-3xl px-6 py-5 mt-2 flex flex-col gap-4">
            {APP_LINKS.map(l => (
              <Link key={l.href} href={l.href} onClick={() => setOpen(false)} className="text-sm text-[#6b6470] hover:text-[#0b0b0e] transition">
                {l.label}
              </Link>
            ))}
            <div className="pt-2 border-t border-[#e6e2d9]">
              {!ready ? null : authenticated ? (
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-[#0b0b0e]/70">{address ? truncate(address) : 'Connected'}</span>
                  <button type="button" onClick={() => logout()} className="text-sm text-[#6b6470] hover:text-[#0b0b0e]">
                    Sign out
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => login()}
                  className="w-full bg-[#0b0b0e] text-white font-semibold rounded-full px-5 py-2.5"
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

  return (
    <nav className="absolute top-0 z-[100] w-full bg-[#faf9f6] border-b border-black/30 isolate">
      {/* Vertical rails aligned to the hero image's left/right edges (mx-4 sm:mx-6).
          They continue straight down into the hero so navbar + image share one
          continuous vertical boundary. */}
      <div className="pointer-events-none absolute inset-y-0 left-4 sm:left-6 w-px bg-black/30" />
      <div className="pointer-events-none absolute inset-y-0 right-4 sm:right-6 w-px bg-black/30" />
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-display font-semibold text-base tracking-[0.08em] uppercase text-[#0b0b0e]">
          <BhishiMark size={22} />
          Bhishi<span className="text-[#c9a15c]">.</span>
        </Link>

        <div className="hidden md:flex items-center gap-8">
          {LINKS.map(l => (
            <Link key={l.href} href={l.href} className="text-sm text-[#0b0b0e]/60 hover:text-[#0b0b0e] transition">
              {l.label}
            </Link>
          ))}
        </div>

        <div className="hidden md:flex items-center gap-3">
          {!ready ? (
            <div className="w-9 h-9 bg-black/5 rounded-full animate-pulse" />
          ) : authenticated ? (
            <AccountMenu />
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
            <Link key={l.href} href={l.href} onClick={() => setOpen(false)} className="text-sm text-[#0b0b0e]/60 hover:text-[#0b0b0e] transition">
              {l.label}
            </Link>
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
