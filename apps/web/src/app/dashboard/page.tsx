'use client';
import { useState, useEffect, useCallback } from 'react';
import { CircleCard, type CircleSummary } from '@/components/CircleCard';
import { CreateWizard } from '@/components/CreateWizard';
import { AuthGate } from '@/components/AuthGate';
import { Faucet } from '@/components/Faucet';
import { Button, Eyebrow, SectionLabel } from '@/components/ui';
import { useMember } from '@/lib/member';
import { apiUrl } from '@/lib/api';
import { useRouter } from 'next/navigation';

export default function DashboardPage() {
  // Must be the SAME identity that joins/commits, or "my circles" would filter
  // on an address that never joined and the user's circles would vanish.
  const { address: userAddress } = useMember();
  const router = useRouter();

  const [circles, setCircles] = useState<CircleSummary[]>([]);
  // `loaded` = we have completed at least one real fetch for the resolved
  // wallet. Until then we MUST show the skeleton, never the empty-state:
  // `loading` starting false + circles=[] would otherwise render "No circles
  // yet" for a frame before the first fetch even runs (and again while the
  // wallet address is still resolving). Distinct from `loading` so background
  // polls don't flip the whole grid back to a skeleton.
  const [loaded, setLoaded] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const fetchCircles = useCallback(async () => {
    if (!userAddress) return;
    try {
      // Read the member's circles from the indexed API (Postgres), NOT by
      // scanning the chain in the browser — Monad's RPC rejects any eth_getLogs
      // spanning more than 100 blocks, so a block-0→latest scan always fails.
      // The indexer worker keeps this in sync from chain events. CircleCard
      // renders straight off this data — it no longer needs its own on-chain
      // reads just to display, so a rate-limited RPC can't make an
      // already-fetched circle look "not there."
      const res = await fetch(apiUrl(`/api/circles?mine=${userAddress.toLowerCase()}`));
      if (!res.ok) throw new Error(`API ${res.status}`);
      const data = (await res.json()) as { circles: CircleSummary[] };
      setCircles(data.circles);
    } catch (e) {
      console.error(e);
    } finally {
      setLoaded(true);
    }
  }, [userAddress]);

  useEffect(() => {
    fetchCircles();
    const interval = setInterval(fetchCircles, 10000);
    return () => clearInterval(interval);
  }, [fetchCircles]);

  return (
    <main className="max-w-6xl mx-auto px-6 pt-16 pb-10 sm:pb-14">
      <AuthGate
        title="Sign in to see your circles"
        blurb="View the circles you're in, start a new one, and claim test funds — all from here."
      >
        {/* Header */}
        <div className="flex items-end justify-between gap-4 flex-wrap mt-4">
          <div>
            <Eyebrow>Your circles &middot; Monad testnet</Eyebrow>
            <h1 className="font-display font-semibold text-4xl sm:text-5xl leading-none mt-3">Dashboard</h1>
          </div>
          <Button onClick={() => setShowCreate(true)}>+ New circle</Button>
        </div>
        <p className="text-[#6b6470] mt-4 text-sm sm:text-base max-w-xl">
          Every circle here is non-custodial. Nobody — not even us — can move your money.
        </p>

        {/* Balance strip */}
        <div className="grid grid-cols-1 sm:grid-cols-3 border border-[#e6e2d9] rounded-sm overflow-hidden mt-7 mb-10">
          <div className="p-5 sm:border-r border-b sm:border-b-0 border-[#e6e2d9]">
            <Faucet variant="inline" />
          </div>
          <div className="p-5 sm:border-r border-b sm:border-b-0 border-[#e6e2d9]">
            <div className="text-xs text-[#6b6470]">In circles</div>
            <div className="font-display font-semibold text-[28px] mt-1.5">{loaded ? circles.length : '—'}</div>
          </div>
          <div className="p-5">
            <div className="text-xs text-[#6b6470]">Network</div>
            <div className="font-display font-semibold text-[28px] mt-1.5">
              Monad <span className="text-sm text-[#6b6470] font-sans font-medium">testnet</span>
            </div>
          </div>
        </div>

        <SectionLabel>Active</SectionLabel>

        {!loaded ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[1, 2].map(i => (
              <div key={i} className="h-44 rounded-sm border border-[#e6e2d9] bg-white/50 animate-pulse" />
            ))}
          </div>
        ) : circles.length === 0 ? (
          <div className="border border-dashed border-[#e6e2d9] rounded-sm py-16 px-6 text-center">
            <p className="font-display text-2xl text-[#0b0b0e]">No circles yet</p>
            <p className="text-sm text-[#6b6470] mt-2 max-w-sm mx-auto">
              Start your own circle, or join one you've been invited to.
            </p>
            <div className="mt-6 flex justify-center">
              <Button variant="ghost" onClick={() => setShowCreate(true)}>Start a circle</Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {circles.map(circle => (
              <CircleCard key={circle.address} circle={circle} userAddress={userAddress} />
            ))}
            <button
              onClick={() => setShowCreate(true)}
              className="border border-dashed border-[#e6e2d9] rounded-sm min-h-[180px] grid place-items-center text-[#6b6470] hover:border-[#0b0b0e] hover:text-[#0b0b0e] transition-colors"
            >
              <span className="text-center">
                <span className="font-display text-3xl block text-[#0b0b0e]">+</span>
                <span className="text-sm mt-2 block">Start a new circle</span>
              </span>
            </button>
          </div>
        )}
      </AuthGate>

      {/* Create modal */}
      {showCreate && (
        <div
          // z-[200] must exceed the Navbar's z-[100] so the backdrop-blur covers
          // the nav too — otherwise the sticky nav renders above the overlay and
          // stays sharp while everything else blurs.
          className="fixed inset-0 z-[200] bg-[#0b0b0e]/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={e => { if (e.target === e.currentTarget) setShowCreate(false); }}
        >
          <div className="bg-[#faf9f6] rounded-sm border border-[#e6e2d9] shadow-2xl p-7 w-full max-w-md relative max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setShowCreate(false)}
              aria-label="Close"
              className="absolute top-4 right-4 text-[#6b6470] hover:text-[#0b0b0e] text-lg"
            >
              ✕
            </button>
            <Eyebrow>New circle</Eyebrow>
            <h2 className="font-display font-semibold text-2xl mt-2 mb-6">Start a circle</h2>
            <CreateWizard onSuccess={(addr) => { setShowCreate(false); router.push(`/circle/${addr}`); }} />
          </div>
        </div>
      )}
    </main>
  );
}
