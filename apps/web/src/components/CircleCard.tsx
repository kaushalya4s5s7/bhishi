/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createPublicClient, http } from 'viem';
import { monadTestnetChain } from '@/lib/privy';
import { circleAbi } from '@/lib/contracts';
import { Card, PhaseBadge, SeatRing, truncate } from '@/components/ui';

const STATE_NAMES = ['FILLING','ACTIVE','ABORTED_FILLING','COMMIT','REVEAL','DRAW','PAYOUT','COMPLETED','STALLED'] as const;
type StateName = typeof STATE_NAMES[number];

const MODE_LABEL = ['Lucky draw', 'Auction'];

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
  const [mode, setMode] = useState<number>(0);
  const [isMember, setIsMember] = useState(false);
  const [hasCommitted, setHasCommitted] = useState(false);
  const [claimable, setClaimable] = useState<bigint>(0n);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [stateVal, seatsVal, memberCountVal, contributionVal, modeVal] = await Promise.all([
          publicClient.readContract({ address: circleAddress, abi: circleAbi as any, functionName: 'state' }),
          publicClient.readContract({ address: circleAddress, abi: circleAbi as any, functionName: 'seats' }),
          publicClient.readContract({ address: circleAddress, abi: circleAbi as any, functionName: 'memberCount' }),
          publicClient.readContract({ address: circleAddress, abi: circleAbi as any, functionName: 'contribution' }),
          publicClient.readContract({ address: circleAddress, abi: circleAbi as any, functionName: 'mode' }),
        ]);
        setState(Number(stateVal));
        setSeats(Number(seatsVal));
        setMemberCount(Number(memberCountVal));
        setContribution(BigInt(contributionVal as any));
        setMode(Number(modeVal));

        if (userAddress) {
          const count = Number(memberCountVal);
          let member = false;
          for (let i = 0; i < count; i++) {
            const m = await publicClient.readContract({ address: circleAddress, abi: circleAbi as any, functionName: 'members', args: [i] });
            if ((m as string).toLowerCase() === userAddress.toLowerCase()) { member = true; break; }
          }
          setIsMember(member);

          if (member) {
            const commitHash = await publicClient.readContract({ address: circleAddress, abi: circleAbi as any, functionName: 'commitmentOf', args: [userAddress] });
            setHasCommitted((commitHash as string) !== '0x' + '0'.repeat(64));
            // memberInfo returns (joined, stakedBond, contribution, claimable)
            const info = await publicClient.readContract({ address: circleAddress, abi: circleAbi as any, functionName: 'memberInfo', args: [userAddress] });
            setClaimable(BigInt((info as any)[3] ?? 0n));
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
    return <div className="rounded-sm border border-[#e6e2d9] bg-white/50 h-44 animate-pulse" />;
  }

  const stateName: StateName = state !== null ? (STATE_NAMES[state] ?? 'FILLING') : 'FILLING';
  const phaseForBadge = stateName === 'ABORTED_FILLING' ? 'ABORTED' : stateName === 'PAYOUT' ? 'COMPLETED' : stateName;

  let actionLabel = 'View';
  const actionHref = `/circle/${circleAddress}`;

  if (stateName === 'FILLING' && !isMember) actionLabel = 'Join circle';
  else if (stateName === 'COMMIT' && isMember && !hasCommitted) actionLabel = 'Commit';
  else if (stateName === 'REVEAL' && isMember && hasCommitted) actionLabel = 'Reveal';
  else if ((stateName === 'PAYOUT' || stateName === 'COMPLETED') && claimable > 0n) actionLabel = 'Claim';

  // Pot for the round = seats × contribution (what a winner takes).
  const pot = (Number(contribution) / 1e6) * seats;

  return (
    <Link href={actionHref} className="group block">
      <Card className="p-5 h-full transition-transform group-hover:-translate-y-0.5 group-hover:border-[#0b0b0e]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-mono text-xs text-[#6b6470]">{truncate(circleAddress)}</div>
            <div className="font-display font-semibold text-[26px] mt-1.5 leading-none">
              {pot.toFixed(2)} <span className="text-[13px] text-[#6b6470] font-sans font-medium">mUSDC pot</span>
            </div>
          </div>
          <PhaseBadge phase={phaseForBadge} />
        </div>

        <div className="my-4">
          <SeatRing filled={memberCount} total={seats} />
        </div>

        <div className="flex items-center justify-between pt-4 border-t border-[#e6e2d9]">
          <span className="font-mono text-xs text-[#6b6470]">
            {MODE_LABEL[mode] ?? 'Circle'}
          </span>
          <span className={`text-sm font-semibold inline-flex items-center gap-1.5 ${claimable > 0n ? 'text-[#c9a15c]' : 'text-[#0b0b0e]'}`}>
            {actionLabel} <span aria-hidden>→</span>
          </span>
        </div>
      </Card>
    </Link>
  );
}
