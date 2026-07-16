/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';
import { useEffect, useState, useCallback } from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { createPublicClient, createWalletClient, http, custom, keccak256, encodePacked } from 'viem';
import { monadTestnetChain } from '@/lib/privy';
import { circleAbi } from '@/lib/contracts';
import { PhaseBadge } from './PhaseBadge';

const STATE_NAMES = ['FILLING','ACTIVE','ABORTED_FILLING','COMMIT','REVEAL','DRAW','PAYOUT','COMPLETED','STALLED'] as const;
type StateName = typeof STATE_NAMES[number];

const publicClient = createPublicClient({ chain: monadTestnetChain, transport: http() });

function truncate(addr: string) {
  return addr.slice(0, 6) + '...' + addr.slice(-4);
}

interface CircleViewProps {
  circleAddress: `0x${string}`;
}

export function CircleView({ circleAddress }: CircleViewProps) {
  const { authenticated, login } = usePrivy();
  const { wallets } = useWallets();
  const embeddedWallet = wallets.find(w => w.walletClientType === 'privy');
  const userAddress = embeddedWallet?.address as `0x${string}` | undefined;

  const [state, setState] = useState<number | null>(null);
  const [seats, setSeats] = useState<number>(0);
  const [members, setMembers] = useState<string[]>([]);
  const [contribution, setContribution] = useState<bigint>(0n);
  const [commitOf, setCommitOf] = useState<string>('0x' + '0'.repeat(64));
  const [claimable, setClaimable] = useState<bigint>(0n);
  const [round, setRound] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [txPending, setTxPending] = useState(false);
  const [txError, setTxError] = useState<string | null>(null);
  const [secret, setSecret] = useState('');
  const [computedHash, setComputedHash] = useState<string | null>(null);
  const [events, setEvents] = useState<{ name: string; args: Record<string, any>; blockNumber: bigint }[]>([]);

  const load = useCallback(async () => {
    try {
      const [stateVal, seatsVal, memberCountVal, contributionVal, roundVal] = await Promise.all([
        publicClient.readContract({ address: circleAddress, abi: circleAbi as any, functionName: 'state' }),
        publicClient.readContract({ address: circleAddress, abi: circleAbi as any, functionName: 'seats' }),
        publicClient.readContract({ address: circleAddress, abi: circleAbi as any, functionName: 'memberCount' }),
        publicClient.readContract({ address: circleAddress, abi: circleAbi as any, functionName: 'contribution' }),
        publicClient.readContract({ address: circleAddress, abi: circleAbi as any, functionName: 'round' }).catch(() => 0),
      ]);

      setState(Number(stateVal));
      setSeats(Number(seatsVal));
      setContribution(BigInt(contributionVal as any));
      setRound(Number(roundVal));

      const count = Number(memberCountVal);
      const memberList: string[] = [];
      for (let i = 0; i < count; i++) {
        const m = await publicClient.readContract({ address: circleAddress, abi: circleAbi as any, functionName: 'members', args: [i] });
        memberList.push(m as string);
      }
      setMembers(memberList);

      if (userAddress) {
        const ch = await publicClient.readContract({ address: circleAddress, abi: circleAbi as any, functionName: 'commitOf', args: [userAddress] }).catch(() => '0x' + '0'.repeat(64));
        setCommitOf(ch as string);
        const cl = await publicClient.readContract({ address: circleAddress, abi: circleAbi as any, functionName: 'claimable', args: [userAddress] }).catch(() => 0n);
        setClaimable(BigInt(cl as any));
      }

      // Load events
      try {
        const logs = await publicClient.getLogs({
          address: circleAddress,
          fromBlock: 0n,
          toBlock: 'latest',
        });
        const parsed = logs.slice(-20).map(l => ({
          name: (l as any).eventName ?? 'Event',
          args: (l as any).args ?? {},
          blockNumber: l.blockNumber ?? 0n,
        }));
        setEvents(parsed.reverse());
      } catch { /* ignore */ }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [circleAddress, userAddress]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, [load]);

  async function getWalletClient() {
    if (!embeddedWallet) throw new Error('No wallet');
    const provider = await embeddedWallet.getEthereumProvider();
    return createWalletClient({ account: userAddress!, chain: monadTestnetChain, transport: custom(provider) });
  }

  async function doWrite(functionName: string, args: any[] = []) {
    setTxPending(true);
    setTxError(null);
    try {
      const wc = await getWalletClient();
      await wc.writeContract({ address: circleAddress, abi: circleAbi as any, functionName, args });
      await load();
    } catch (e: any) {
      setTxError(e?.shortMessage ?? e?.message ?? 'Transaction failed');
    } finally {
      setTxPending(false);
    }
  }

  function computeHash() {
    if (!userAddress || !secret) return;
    try {
      const hash = keccak256(encodePacked(['address', 'uint256'], [userAddress, BigInt(secret)]));
      setComputedHash(hash);
    } catch {
      setTxError('Invalid secret — must be a number');
    }
  }

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-12">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-100 rounded w-60" />
          <div className="h-40 bg-gray-100 rounded-xl" />
          <div className="h-40 bg-gray-100 rounded-xl" />
        </div>
      </div>
    );
  }

  const stateName: StateName = state !== null ? (STATE_NAMES[state] ?? 'FILLING') : 'FILLING';
  const isMember = members.some(m => m.toLowerCase() === userAddress?.toLowerCase());
  const hasCommitted = commitOf !== '0x' + '0'.repeat(64);

  const phaseForBadge = (() => {
    if (stateName === 'ABORTED_FILLING') return 'ABORTED';
    if (stateName === 'PAYOUT') return 'COMPLETED';
    return stateName;
  })();

  return (
    <div className="max-w-3xl mx-auto px-6 py-12 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <div className="font-mono text-sm text-gray-500 mb-1">{truncate(circleAddress)}</div>
          <div className="flex items-center gap-3">
            <PhaseBadge phase={phaseForBadge as any} />
            {round > 0 && <span className="text-sm text-gray-500">Round {round}</span>}
          </div>
        </div>
        <button
          onClick={() => load()}
          className="text-sm text-purple-600 hover:text-purple-800 border border-purple-200 px-3 py-1.5 rounded-lg transition"
        >
          Refresh
        </button>
      </div>

      {/* Progress bar */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-gray-700">Seats filled</span>
          <span className="text-sm text-gray-500">{members.length} / {seats}</span>
        </div>
        <div className="flex gap-2 flex-wrap">
          {Array.from({ length: seats }).map((_, i) => (
            <div
              key={i}
              className={`w-8 h-8 rounded-full border-2 flex items-center justify-center text-xs font-bold transition ${
                i < members.length
                  ? 'bg-purple-600 border-purple-600 text-white'
                  : 'border-gray-200 text-gray-300'
              }`}
            >
              {i < members.length ? '✓' : i + 1}
            </div>
          ))}
        </div>
        <div className="mt-3 text-sm text-gray-600">
          Contribution: <span className="font-medium">{(Number(contribution) / 1e6).toFixed(2)} USDC</span> / round
        </div>
      </div>

      {/* Member list */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">Members</h2>
        {members.length === 0 ? (
          <p className="text-sm text-gray-400">No members yet.</p>
        ) : (
          <ul className="space-y-2">
            {members.map((m, i) => {
              const isYou = m.toLowerCase() === userAddress?.toLowerCase();
              return (
                <li key={i} className="flex items-center justify-between text-sm">
                  <span className="font-mono text-gray-700">{truncate(m)}</span>
                  <div className="flex gap-2">
                    {isYou && <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">you</span>}
                    {stateName === 'COMMIT' && (
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${isYou && hasCommitted ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {isYou ? (hasCommitted ? 'committed' : 'pending') : '—'}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Phase action panel */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">Actions</h2>

        {!authenticated ? (
          <button onClick={() => login()} className="bg-purple-600 hover:bg-purple-700 text-white font-semibold px-6 py-2.5 rounded-lg transition">
            Sign in to participate
          </button>
        ) : stateName === 'FILLING' ? (
          isMember ? (
            <p className="text-sm text-gray-500">You have joined this circle. Waiting for all seats to fill.</p>
          ) : (
            <button
              onClick={() => doWrite('join')}
              disabled={txPending}
              className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-semibold px-6 py-2.5 rounded-lg transition"
            >
              {txPending ? 'Joining...' : 'Join circle'}
            </button>
          )
        ) : stateName === 'COMMIT' ? (
          isMember ? (
            hasCommitted ? (
              <p className="text-sm text-green-600 font-medium">You have committed this round. Wait for the reveal phase.</p>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Secret number (save this!)</label>
                  <input
                    type="number"
                    value={secret}
                    onChange={e => { setSecret(e.target.value); setComputedHash(null); }}
                    placeholder="e.g. 123456"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-400"
                  />
                </div>
                {secret && (
                  <button onClick={computeHash} className="text-sm text-purple-600 hover:text-purple-800 underline">
                    Compute hash
                  </button>
                )}
                {computedHash && (
                  <div className="bg-gray-50 rounded-lg p-3">
                    <div className="text-xs text-gray-500 mb-1">Commit hash</div>
                    <div className="font-mono text-xs text-gray-700 break-all">{computedHash}</div>
                  </div>
                )}
                <button
                  onClick={() => computedHash && doWrite('commit', [computedHash as `0x${string}`])}
                  disabled={txPending || !computedHash}
                  className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-semibold px-6 py-2.5 rounded-lg transition"
                >
                  {txPending ? 'Committing...' : 'Commit'}
                </button>
              </div>
            )
          ) : (
            <p className="text-sm text-gray-400">You are not a member of this circle.</p>
          )
        ) : stateName === 'REVEAL' ? (
          isMember ? (
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">Your secret number</label>
                <input
                  type="number"
                  value={secret}
                  onChange={e => setSecret(e.target.value)}
                  placeholder="Enter the secret you committed"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-400"
                />
              </div>
              <button
                onClick={() => secret && doWrite('reveal', [BigInt(secret)])}
                disabled={txPending || !secret}
                className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-semibold px-6 py-2.5 rounded-lg transition"
              >
                {txPending ? 'Revealing...' : 'Reveal'}
              </button>
            </div>
          ) : (
            <p className="text-sm text-gray-400">You are not a member of this circle.</p>
          )
        ) : stateName === 'DRAW' ? (
          <div className="flex items-center gap-3 text-gray-600">
            <svg className="animate-spin h-5 w-5 text-purple-600" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
            </svg>
            <span className="text-sm">Waiting for VRF draw...</span>
          </div>
        ) : stateName === 'PAYOUT' || stateName === 'COMPLETED' ? (
          claimable > 0n ? (
            <div className="space-y-3">
              <p className="text-sm text-gray-600">
                Claimable: <span className="font-bold text-green-600">{(Number(claimable) / 1e6).toFixed(2)} USDC</span>
              </p>
              <button
                onClick={() => doWrite('claim')}
                disabled={txPending}
                className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-semibold px-6 py-2.5 rounded-lg transition"
              >
                {txPending ? 'Claiming...' : 'Claim payout'}
              </button>
            </div>
          ) : (
            <p className="text-sm text-gray-500">Nothing to claim right now.</p>
          )
        ) : stateName === 'STALLED' ? (
          <div className="space-y-3">
            <p className="text-sm text-amber-600">This circle is stalled — VRF did not respond. You can reclaim your funds.</p>
            <button
              onClick={() => doWrite('reclaimOnStall')}
              disabled={txPending}
              className="bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white font-semibold px-6 py-2.5 rounded-lg transition"
            >
              {txPending ? 'Reclaiming...' : 'Reclaim funds'}
            </button>
          </div>
        ) : stateName === 'ABORTED_FILLING' ? (
          <div className="space-y-3">
            <p className="text-sm text-red-500">Circle was aborted during filling. You can get a refund.</p>
            <button
              onClick={() => doWrite('refundFilling')}
              disabled={txPending}
              className="bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white font-semibold px-6 py-2.5 rounded-lg transition"
            >
              {txPending ? 'Refunding...' : 'Get refund'}
            </button>
          </div>
        ) : (
          <p className="text-sm text-gray-400">No actions available in this phase.</p>
        )}

        {txError && (
          <div className="mt-4 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
            {txError}
          </div>
        )}
      </div>

      {/* Event feed */}
      {events.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Recent Events</h2>
          <ul className="space-y-2">
            {events.map((ev, i) => (
              <li key={i} className="text-xs text-gray-500 font-mono flex gap-2">
                <span className="text-purple-500">[{ev.blockNumber.toString()}]</span>
                <span>{ev.name}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
