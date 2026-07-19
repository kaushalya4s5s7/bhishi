'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { CircleCard, type CircleSummary } from '@/components/CircleCard';
import { CreateWizard } from '@/components/CreateWizard';
import { AuthGate } from '@/components/AuthGate';
import { Faucet } from '@/components/Faucet';
import { Avatar, Button, Eyebrow, Seal } from '@/components/ui';
import { useProfile } from '@/lib/profile';
import { useMember } from '@/lib/member';
import { apiUrl } from '@/lib/api';
import { useRouter } from 'next/navigation';

const STATE_ORDER = ['FILLING', 'ACTIVE', 'ABORTED_FILLING', 'COMMIT', 'REVEAL', 'DRAW', 'PAYOUT', 'COMPLETED', 'STALLED'];
const DONE_STATES = new Set(['PAYOUT', 'COMPLETED']);
const MODE_LABEL: Record<string, string> = { LUCKY_DRAW: 'Lucky draw', AUCTION: 'Auction' };

export default function DashboardPage() {
  const { address: userAddress } = useMember();
  const { profile } = useProfile();
  const router = useRouter();

  const [circles, setCircles] = useState<CircleSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [query, setQuery] = useState('');

  const fetchCircles = useCallback(async () => {
    if (!userAddress) return;
    try {
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

  const displayName = profile?.displayName || profile?.email || (userAddress ? `${userAddress.slice(0, 6)}…${userAddress.slice(-4)}` : 'there');

  const filteredCircles = useMemo(() => {
    if (!query.trim()) return circles;
    const q = query.toLowerCase();
    return circles.filter(c => c.address.toLowerCase().includes(q) || MODE_LABEL[c.mode].toLowerCase().includes(q));
  }, [circles, query]);

  // Active vs completed split, and average seat-fill for each — the two
  // real, indexer-backed percentages that stand in for the reference's
  // "Prioritized/Additional tasks" gradient stat cards.
  const { activeCircles, completedCircles, activeFillPct, completedFillPct } = useMemo(() => {
    const active = circles.filter(c => !DONE_STATES.has(c.state));
    const completed = circles.filter(c => DONE_STATES.has(c.state));
    const avgFill = (list: CircleSummary[]) =>
      list.length === 0 ? 0 : Math.round((list.reduce((s, c) => s + c.memberCount / c.seats, 0) / list.length) * 100);
    return {
      activeCircles: active,
      completedCircles: completed,
      activeFillPct: avgFill(active),
      completedFillPct: avgFill(completed),
    };
  }, [circles]);

  const totalPot = useMemo(
    () => circles.reduce((sum, c) => sum + (Number(c.contribution) / 1e6) * c.seats, 0),
    [circles],
  );

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 pt-8 sm:pt-10 pb-14">
      <AuthGate
        title="Sign in to see your circles"
        blurb="View the circles you're in, start a new one, and claim test funds — all from here."
      >
        {/* Top bar */}
        <div className="flex items-center justify-between gap-4 flex-wrap mb-8">
          <div className="flex items-center gap-3">
            <Seal size={40} />
            <div>
              <h1 className="font-display font-semibold text-2xl leading-none">Welcome, {displayName}</h1>
              <p className="text-[#6b6470] text-sm mt-1">Your circles, at a glance</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#6b6470] text-sm" aria-hidden>⌕</span>
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search circles"
                className="bg-[#f0ede4] rounded-full pl-9 pr-4 py-2.5 text-sm w-48 sm:w-64 focus:outline-none focus:ring-2 focus:ring-[#c9a15c]/40"
              />
            </div>
            <Button onClick={() => setShowCreate(true)}>+ New circle</Button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-6">
          {/* Main column */}
          <div className="min-w-0">
            <div className="grid grid-cols-1 sm:grid-cols-[260px_1fr_1fr] gap-4">
              {/* Profile card */}
              <div className="bg-white rounded-2xl p-6 flex flex-col items-center text-center shadow-sm">
                <div className="relative mb-4">
                  <div className="w-24 h-24 rounded-full bg-gradient-to-br from-[#c9a15c] to-[#e7c98a] p-[3px]">
                    {userAddress && (
                      <Avatar key={userAddress} seed={userAddress} avatarUrl={profile?.avatarUrl} size={90} className="border-2 border-[#faf9f6]" />
                    )}
                  </div>
                </div>
                <p className="font-display font-semibold text-lg truncate max-w-full">{displayName}</p>
                <p className="text-xs text-[#6b6470] mt-1">Monad testnet member</p>
                <div className="flex gap-2 mt-5 w-full">
                  <div className="flex-1 bg-[#f6f4ee] rounded-xl py-2.5">
                    <div className="font-display font-semibold text-lg">{loaded ? circles.length : '—'}</div>
                    <div className="text-[10px] text-[#6b6470] uppercase tracking-wide mt-0.5">Circles</div>
                  </div>
                  <div className="flex-1 bg-[#f6f4ee] rounded-xl py-2.5">
                    <div className="font-display font-semibold text-lg">{loaded ? completedCircles.length : '—'}</div>
                    <div className="text-[10px] text-[#6b6470] uppercase tracking-wide mt-0.5">Done</div>
                  </div>
                  <div className="flex-1 bg-[#f6f4ee] rounded-xl py-2.5">
                    <div className="font-display font-semibold text-lg">{loaded ? totalPot.toFixed(0) : '—'}</div>
                    <div className="text-[10px] text-[#6b6470] uppercase tracking-wide mt-0.5">mUSDC</div>
                  </div>
                </div>
              </div>

              {/* Active circles stat card */}
              <div className="rounded-2xl p-6 flex flex-col justify-between shadow-sm" style={{ background: 'linear-gradient(135deg, #f6e3d5, #ecdcf0)' }}>
                <div className="flex items-start justify-between">
                  <p className="font-display font-semibold text-lg leading-tight">Active<br />circles</p>
                  <span className="w-9 h-9 rounded-full bg-white/60 grid place-items-center text-sm" aria-hidden>◷</span>
                </div>
                <div>
                  <p className="font-display font-semibold text-4xl">{loaded ? `${activeFillPct}%` : '—'}</p>
                  <p className="text-xs text-[#0b0b0e]/60 mt-1">Avg. seats filled &middot; {activeCircles.length} circle{activeCircles.length === 1 ? '' : 's'}</p>
                </div>
              </div>

              {/* Completed circles stat card */}
              <div className="rounded-2xl p-6 flex flex-col justify-between shadow-sm" style={{ background: 'linear-gradient(135deg, #dcefe8, #dbe7f5)' }}>
                <div className="flex items-start justify-between">
                  <p className="font-display font-semibold text-lg leading-tight">Completed<br />circles</p>
                  <span className="w-9 h-9 rounded-full bg-white/60 grid place-items-center text-sm" aria-hidden>✓</span>
                </div>
                <div>
                  <p className="font-display font-semibold text-4xl">{loaded ? `${completedFillPct}%` : '—'}</p>
                  <p className="text-xs text-[#0b0b0e]/60 mt-1">Avg. seats filled &middot; {completedCircles.length} circle{completedCircles.length === 1 ? '' : 's'}</p>
                </div>
              </div>
            </div>

            {/* Faucet / network strip */}
            <div className="bg-[#f0ede4] rounded-2xl mt-4 p-5 flex items-center justify-between gap-4 flex-wrap">
              <div>
                <p className="font-display font-semibold text-base">Test funds</p>
                <p className="text-xs text-[#6b6470] mt-0.5">Claim mUSDC to join or contribute on Monad testnet</p>
              </div>
              <Faucet variant="inline" />
            </div>

            {/* Circles grid (was "Focusing" chart section) */}
            <div className="mt-8">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="font-display font-semibold text-xl">Your circles</h2>
                  <p className="text-xs text-[#6b6470] mt-0.5">Everything you&apos;ve joined or created</p>
                </div>
              </div>

              {!loaded ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {[1, 2].map(i => (
                    <div key={i} className="h-44 rounded-2xl bg-white/60 animate-pulse" />
                  ))}
                </div>
              ) : filteredCircles.length === 0 ? (
                <div className="border border-dashed border-[#e6e2d9] rounded-2xl py-16 px-6 text-center bg-white/50">
                  <p className="font-display text-2xl text-[#0b0b0e]">
                    {circles.length === 0 ? 'No circles yet' : 'No circles match your search'}
                  </p>
                  {circles.length === 0 && (
                    <>
                      <p className="text-sm text-[#6b6470] mt-2 max-w-sm mx-auto">
                        Start your own circle, or join one you&apos;ve been invited to.
                      </p>
                      <div className="mt-6 flex justify-center">
                        <Button variant="ghost" onClick={() => setShowCreate(true)}>Start a circle</Button>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {filteredCircles.map(circle => (
                    <CircleCard key={circle.address} circle={circle} userAddress={userAddress} />
                  ))}
                  <button
                    onClick={() => setShowCreate(true)}
                    className="border border-dashed border-[#e6e2d9] rounded-2xl min-h-[180px] grid place-items-center text-[#6b6470] hover:border-[#0b0b0e] hover:text-[#0b0b0e] transition-colors bg-white/40"
                  >
                    <span className="text-center">
                      <span className="font-display text-3xl block text-[#0b0b0e]">+</span>
                      <span className="text-sm mt-2 block">Start a new circle</span>
                    </span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Right rail */}
          <div className="space-y-6">
            {/* Upcoming: circles with an action pending on the user */}
            <div className="bg-white rounded-2xl p-6 shadow-sm">
              <div className="flex items-center justify-between mb-5">
                <h2 className="font-display font-semibold text-lg">Needs attention</h2>
                <span className="w-8 h-8 rounded-full bg-[#f6f4ee] grid place-items-center text-sm" aria-hidden>⏰</span>
              </div>
              {!loaded ? (
                <div className="space-y-3">
                  {[1, 2, 3].map(i => <div key={i} className="h-12 rounded-xl bg-[#f6f4ee] animate-pulse" />)}
                </div>
              ) : activeCircles.length === 0 ? (
                <p className="text-sm text-[#6b6470]">No active circles right now.</p>
              ) : (
                <div className="divide-y divide-[#f0ede4]">
                  {activeCircles.slice(0, 5).map(c => (
                    <a
                      key={c.address}
                      href={`/circle/${c.address}`}
                      className="flex items-center justify-between py-3 group"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{c.address.slice(0, 6)}…{c.address.slice(-4)}</p>
                        <p className="text-xs text-[#6b6470] mt-0.5">{STATE_ORDER.includes(c.state) ? c.state.charAt(0) + c.state.slice(1).toLowerCase() : c.state} &middot; {MODE_LABEL[c.mode]}</p>
                      </div>
                      <span className="text-[#6b6470] group-hover:text-[#0b0b0e] transition-colors" aria-hidden>↗</span>
                    </a>
                  ))}
                </div>
              )}
              {activeCircles.length > 5 && (
                <a href="#" className="mt-4 inline-flex items-center gap-1 text-sm text-[#6b6470] hover:text-[#0b0b0e] transition-colors">
                  See all circles <span aria-hidden>›</span>
                </a>
              )}
            </div>

            {/* Seat fill per circle — stands in for "Developed areas" progress bars */}
            <div className="bg-white rounded-2xl p-6 shadow-sm">
              <h2 className="font-display font-semibold text-lg">Seats filled</h2>
              <p className="text-xs text-[#6b6470] mt-0.5 mb-5">Per-circle occupancy</p>
              {!loaded ? (
                <div className="space-y-4">
                  {[1, 2, 3].map(i => <div key={i} className="h-8 rounded bg-[#f6f4ee] animate-pulse" />)}
                </div>
              ) : circles.length === 0 ? (
                <p className="text-sm text-[#6b6470]">Join a circle to see progress here.</p>
              ) : (
                <div className="space-y-4">
                  {circles.slice(0, 6).map(c => {
                    const pct = Math.round((c.memberCount / c.seats) * 100);
                    const full = pct === 100;
                    return (
                      <div key={c.address}>
                        <div className="flex items-center justify-between text-sm mb-1.5">
                          <span className="font-medium truncate">{c.address.slice(0, 6)}…{c.address.slice(-4)}</span>
                          <span className="text-[#6b6470]">{c.memberCount}/{c.seats}</span>
                        </div>
                        <div className="h-2 rounded-full bg-[#f0ede4] overflow-hidden">
                          <div
                            className={`h-full rounded-full ${full ? 'bg-[#3a6d4a]' : 'bg-[#c9a15c]'}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </AuthGate>

      {/* Create modal */}
      {showCreate && (
        <div
          className="fixed inset-0 z-[200] bg-[#0b0b0e]/50 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={e => { if (e.target === e.currentTarget) setShowCreate(false); }}
        >
          <div className="bg-[#faf9f6] rounded-[28px] shadow-2xl w-full max-w-2xl relative max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-[#faf9f6] px-8 pt-7 pb-5 flex items-start justify-between gap-4 border-b border-[#e6e2d9]/80 rounded-t-[28px]">
              <div>
                <Eyebrow>New circle</Eyebrow>
                <h2 className="font-display font-semibold text-2xl mt-2">Start a circle</h2>
              </div>
              <button
                onClick={() => setShowCreate(false)}
                aria-label="Close"
                className="w-9 h-9 rounded-full bg-white shadow-sm grid place-items-center text-[#6b6470] hover:text-[#0b0b0e] transition-colors shrink-0"
              >
                ✕
              </button>
            </div>
            <div className="px-8 py-7">
              <CreateWizard onSuccess={(addr) => { setShowCreate(false); router.push(`/circle/${addr}`); }} />
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
