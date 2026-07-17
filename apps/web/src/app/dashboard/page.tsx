/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';
import { useState, useEffect, useCallback } from 'react';
import { createPublicClient, http } from 'viem';
import { monadTestnetChain } from '@/lib/privy';
import { addresses, circleAbi } from '@/lib/contracts';
import { CircleCard } from '@/components/CircleCard';
import { CreateWizard } from '@/components/CreateWizard';
import { AuthGate } from '@/components/AuthGate';
import { Faucet } from '@/components/Faucet';
import { Button, Eyebrow, SectionLabel } from '@/components/ui';
import { useMember } from '@/lib/member';
import { useRouter } from 'next/navigation';

const publicClient = createPublicClient({ chain: monadTestnetChain, transport: http() });

export default function DashboardPage() {
  // Must be the SAME identity that joins/commits, or "my circles" would filter
  // on an address that never joined and the user's circles would vanish.
  const { address: userAddress } = useMember();
  const router = useRouter();

  const [circles, setCircles] = useState<`0x${string}`[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const fetchCircles = useCallback(async () => {
    if (!userAddress) return;
    setLoading(true);
    try {
      const logs = await publicClient.getLogs({
        address: addresses.monadTestnet.factory,
        event: {
          type: 'event',
          name: 'CircleCreated',
          inputs: [
            { type: 'address', name: 'circle', indexed: true },
            { type: 'address', name: 'creator', indexed: true },
            { type: 'uint8', name: 'seats', indexed: false },
            { type: 'uint256', name: 'contribution', indexed: false },
          ],
        },
        fromBlock: 0n,
        toBlock: 'latest',
      });

      const circleAddresses = logs.map(l => l.args.circle as `0x${string}`).filter(Boolean);

      const userCircles: `0x${string}`[] = [];
      await Promise.all(circleAddresses.map(async (addr) => {
        try {
          const memberCount = await publicClient.readContract({ address: addr, abi: circleAbi as any, functionName: 'memberCount' });
          const count = Number(memberCount);
          for (let i = 0; i < count; i++) {
            const m = await publicClient.readContract({ address: addr, abi: circleAbi as any, functionName: 'members', args: [i] });
            if ((m as string).toLowerCase() === userAddress.toLowerCase()) {
              userCircles.push(addr);
              break;
            }
          }
        } catch { /* skip */ }
      }));
      setCircles(userCircles);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [userAddress]);

  useEffect(() => {
    fetchCircles();
    const interval = setInterval(fetchCircles, 10000);
    return () => clearInterval(interval);
  }, [fetchCircles]);

  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
      <AuthGate
        title="Sign in to see your circles"
        blurb="View the circles you're in, start a new one, and claim test funds — all from here."
      >
        {/* Header */}
        <div className="flex items-end justify-between gap-4 flex-wrap">
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
            <div className="font-display font-semibold text-[28px] mt-1.5">{circles.length}</div>
          </div>
          <div className="p-5">
            <div className="text-xs text-[#6b6470]">Network</div>
            <div className="font-display font-semibold text-[28px] mt-1.5">
              Monad <span className="text-sm text-[#6b6470] font-sans font-medium">testnet</span>
            </div>
          </div>
        </div>

        <SectionLabel>Active</SectionLabel>

        {loading && circles.length === 0 ? (
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
            {circles.map(addr => (
              <CircleCard key={addr} circleAddress={addr} userAddress={userAddress} />
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
          className="fixed inset-0 z-50 bg-[#0b0b0e]/60 backdrop-blur-sm flex items-center justify-center p-4"
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
