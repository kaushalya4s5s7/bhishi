/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';
import { useState, useEffect, useCallback } from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { createPublicClient, http } from 'viem';
import { monadTestnetChain } from '@/lib/privy';
import { addresses, circleAbi } from '@/lib/contracts';
import { CircleCard } from '@/components/CircleCard';
import { CreateWizard } from '@/components/CreateWizard';
import { useRouter } from 'next/navigation';

const publicClient = createPublicClient({ chain: monadTestnetChain, transport: http() });

export default function DashboardPage() {
  const { ready, authenticated, login } = usePrivy();
  const { wallets } = useWallets();
  const embeddedWallet = wallets.find(w => w.walletClientType === 'privy');
  const userAddress = embeddedWallet?.address as `0x${string}` | undefined;
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

  if (!ready) {
    return (
      <main className="max-w-6xl mx-auto px-6 py-12">
        <div className="animate-pulse h-8 bg-gray-100 rounded w-40 mb-6" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {[1,2,3,4].map(i => <div key={i} className="h-40 bg-gray-100 rounded-xl animate-pulse" />)}
        </div>
      </main>
    );
  }

  if (!authenticated) {
    return (
      <main className="max-w-6xl mx-auto px-6 py-24 text-center">
        <h1 className="text-3xl font-bold text-gray-900 mb-4">My Circles</h1>
        <p className="text-gray-600 mb-8">Sign in to view and manage your savings circles.</p>
        <button
          onClick={() => login()}
          className="bg-purple-600 hover:bg-purple-700 text-white font-semibold px-8 py-3 rounded-xl transition"
        >
          Sign in
        </button>
      </main>
    );
  }

  return (
    <main className="max-w-6xl mx-auto px-6 py-12">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold text-gray-900">My Circles</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="bg-purple-600 hover:bg-purple-700 text-white font-semibold px-5 py-2.5 rounded-xl transition"
        >
          + New circle
        </button>
      </div>

      {loading && circles.length === 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {[1,2,3,4].map(i => <div key={i} className="h-40 bg-gray-100 rounded-xl animate-pulse" />)}
        </div>
      ) : circles.length === 0 ? (
        <div className="text-center py-24 text-gray-500">
          <p className="text-lg mb-2">No circles yet.</p>
          <p className="text-sm">Create one or get invited to join an existing circle.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {circles.map(addr => (
            <CircleCard key={addr} circleAddress={addr} userAddress={userAddress} />
          ))}
        </div>
      )}

      {showCreate && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          onClick={e => { if (e.target === e.currentTarget) setShowCreate(false); }}
        >
          <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md relative">
            <button
              onClick={() => setShowCreate(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 text-xl"
            >
              ✕
            </button>
            <h2 className="text-xl font-bold text-gray-900 mb-6">Create a new circle</h2>
            <CreateWizard onSuccess={(addr) => { setShowCreate(false); router.push(`/circle/${addr}`); }} />
          </div>
        </div>
      )}
    </main>
  );
}
