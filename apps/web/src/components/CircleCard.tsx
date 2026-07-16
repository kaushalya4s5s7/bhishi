/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createPublicClient, http } from 'viem';
import { monadTestnetChain } from '@/lib/privy';
import { circleAbi } from '@/lib/contracts';
import { PhaseBadge } from './PhaseBadge';

const STATE_NAMES = ['FILLING','ACTIVE','ABORTED','COMMIT','REVEAL','DRAW','PAYOUT','COMPLETED','STALLED'] as const;
type StateName = typeof STATE_NAMES[number];

function truncate(addr: string) {
  return addr.slice(0, 6) + '...' + addr.slice(-4);
}

const publicClient = createPublicClient({ chain: monadTestnetChain, transport: http() });

interface CircleCardProps {
  circleAddress: `0x${string}`;
  userAddress?: `0x${string}`;
}

export function CircleCard({ circleAddress, userAddress }: CircleCardProps) {
  const [state, setState] = useState<number | null>(null);
  const [seats, setSeats] = useState<number>(0);
  const [memberCount, setMemberCount] = useState<number>(0);
  const [contribution, setContribution] = useState<bigint>(0n);
  const [isMember, setIsMember] = useState(false);
  const [hasCommitted, setHasCommitted] = useState(false);
  const [claimable, setClaimable] = useState<bigint>(0n);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [stateVal, seatsVal, memberCountVal, contributionVal] = await Promise.all([
          publicClient.readContract({ address: circleAddress, abi: circleAbi as any, functionName: 'state' }),
          publicClient.readContract({ address: circleAddress, abi: circleAbi as any, functionName: 'seats' }),
          publicClient.readContract({ address: circleAddress, abi: circleAbi as any, functionName: 'memberCount' }),
          publicClient.readContract({ address: circleAddress, abi: circleAbi as any, functionName: 'contribution' }),
        ]);
        setState(Number(stateVal));
        setSeats(Number(seatsVal));
        setMemberCount(Number(memberCountVal));
        setContribution(BigInt(contributionVal as any));

        if (userAddress) {
          const count = Number(memberCountVal);
          let member = false;
          for (let i = 0; i < count; i++) {
            const m = await publicClient.readContract({ address: circleAddress, abi: circleAbi as any, functionName: 'members', args: [i] });
            if ((m as string).toLowerCase() === userAddress.toLowerCase()) { member = true; break; }
          }
          setIsMember(member);

          if (member) {
            const commitHash = await publicClient.readContract({ address: circleAddress, abi: circleAbi as any, functionName: 'commitOf', args: [userAddress] });
            setHasCommitted((commitHash as string) !== '0x' + '0'.repeat(64));
            const cl = await publicClient.readContract({ address: circleAddress, abi: circleAbi as any, functionName: 'claimable', args: [userAddress] });
            setClaimable(BigInt(cl as any));
          }
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [circleAddress, userAddress]);

  if (loading) {
    return <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 animate-pulse h-40" />;
  }

  const stateName: StateName = state !== null ? (STATE_NAMES[state] ?? 'FILLING') : 'FILLING';
  const phaseForBadge = stateName === 'ABORTED' ? 'ABORTED' : stateName === 'PAYOUT' ? 'COMPLETED' : stateName;

  let actionLabel = 'View';
  const actionHref = `/circle/${circleAddress}`;

  if (stateName === 'FILLING' && !isMember) actionLabel = 'Join circle';
  else if (stateName === 'COMMIT' && isMember && !hasCommitted) actionLabel = 'Commit';
  else if (stateName === 'REVEAL' && isMember && hasCommitted) actionLabel = 'Reveal';
  else if ((stateName === 'PAYOUT' || stateName === 'COMPLETED') && claimable > 0n) actionLabel = 'Claim';

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <Link href={`/circle/${circleAddress}`} className="font-mono text-sm text-gray-700 hover:text-purple-600 transition">
          {truncate(circleAddress)}
        </Link>
        <PhaseBadge phase={phaseForBadge as any} />
      </div>
      <div className="text-sm text-gray-600">
        <span className="font-medium">{memberCount} / {seats}</span> seats filled
      </div>
      <div className="text-sm text-gray-600">
        Contribution: <span className="font-medium">{(Number(contribution) / 1e6).toFixed(2)} USDC</span> / round
      </div>
      <Link
        href={actionHref}
        className="mt-auto bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition text-center"
      >
        {actionLabel}
      </Link>
    </div>
  );
}
