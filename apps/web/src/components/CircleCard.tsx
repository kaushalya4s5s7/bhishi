/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { circleAbi } from '@/lib/contracts';
import { publicClient } from '@/lib/wallet';
import { PhaseBadge, SeatRing, truncate } from '@/components/ui';

const STATE_NAMES = ['FILLING','ACTIVE','ABORTED_FILLING','COMMIT','REVEAL','DRAW','PAYOUT','COMPLETED','STALLED'] as const;
type StateName = typeof STATE_NAMES[number];

const MODE_LABEL = ['Lucky draw', 'Auction'];

/** The indexed fields the dashboard's list API already returns per circle —
 *  passing these in means CircleCard never needs an on-chain read just to
 *  render its core content, so a rate-limited/slow RPC can no longer make an
 *  already-fetched circle look "not there." */
export interface CircleSummary {
  address: `0x${string}`;
  state: string;
  seats: number;
  memberCount: number;
  contribution: string;
  mode: 'LUCKY_DRAW' | 'AUCTION';
  // 0-indexed round the circle is currently on. Total rounds in a cycle equals
  // `seats` (every member wins exactly once). Optional so an older cached
  // summary without it degrades gracefully.
  currentRound?: number;
}

interface CircleCardProps {
  circle: CircleSummary;
  userAddress?: `0x${string}`;
}

const STATE_ORDINAL: Record<string, number> = Object.fromEntries(STATE_NAMES.map((n, i) => [n, i]));

export function CircleCard({ circle, userAddress }: CircleCardProps) {
  const circleAddress = circle.address;
  // Live, per-user fields NOT covered by the indexed API (commit status,
  // claimable balance) — fetched best-effort. A failure here (e.g. the public
  // RPC's rate limit) only means the "Commit"/"Claim" label falls back to
  // "View"; it never blocks the card itself from rendering the API data.
  const [isMember, setIsMember] = useState(false);
  const [hasCommitted, setHasCommitted] = useState(false);
  const [claimable, setClaimable] = useState<bigint>(0n);

  useEffect(() => {
    if (!userAddress) return;
    let cancelled = false;
    async function loadLiveState() {
      try {
        const [info, commitHash] = await Promise.all([
          publicClient.readContract({ address: circleAddress, abi: circleAbi as any, functionName: 'memberInfo', args: [userAddress] }),
          publicClient.readContract({ address: circleAddress, abi: circleAbi as any, functionName: 'commitmentOf', args: [userAddress] }),
        ]);
        if (cancelled) return;
        // memberInfo returns (joined, stakedBond, contribution, claimable)
        const [joined, , , claimableVal] = info as [boolean, bigint, bigint, bigint];
        setIsMember(joined);
        setClaimable(BigInt(claimableVal ?? 0n));
        setHasCommitted(joined && (commitHash as string) !== '0x' + '0'.repeat(64));
      } catch (e) {
        // Best-effort only — the card already has everything it needs from
        // the indexed API to render without this.
        console.error(e);
      }
    }
    loadLiveState();
    return () => { cancelled = true; };
  }, [circleAddress, userAddress]);

  const state = STATE_ORDINAL[circle.state] ?? 0;
  const seats = circle.seats;
  const memberCount = circle.memberCount;
  const contribution = BigInt(circle.contribution);
  const mode = circle.mode === 'AUCTION' ? 1 : 0;

  const stateName: StateName = (STATE_NAMES[state] ?? 'FILLING');
  const phaseForBadge = stateName === 'ABORTED_FILLING' ? 'ABORTED' : stateName === 'PAYOUT' ? 'COMPLETED' : stateName;

  let actionLabel = 'View';
  const actionHref = `/circle/${circleAddress}`;

  if (stateName === 'FILLING' && !isMember) actionLabel = 'Join circle';
  else if (stateName === 'COMMIT' && isMember && !hasCommitted) actionLabel = 'Commit';
  else if (stateName === 'REVEAL' && isMember && hasCommitted) actionLabel = 'Reveal';
  else if ((stateName === 'PAYOUT' || stateName === 'COMPLETED') && claimable > 0n) actionLabel = 'Claim';

  // Pot for the round = seats × contribution (what a winner takes).
  const pot = (Number(contribution) / 1e6) * seats;

  // Round progress. A full cycle is `seats` rounds (each member wins once).
  // currentRound is 0-indexed: while active, rounds completed = currentRound;
  // once COMPLETED, all `seats` rounds are done. Only meaningful once the
  // circle has left FILLING (rounds haven't started during filling).
  const roundsDone =
    stateName === 'COMPLETED' ? seats : Math.min(circle.currentRound ?? 0, seats);
  const cycleStarted = stateName !== 'FILLING' && stateName !== 'ABORTED_FILLING';

  return (
    <Link href={actionHref} className="group block">
      <div className="rounded-2xl bg-white shadow-sm p-5 h-full transition-transform group-hover:-translate-y-0.5 hover:shadow-md">
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

        <div className="flex items-center justify-between pt-4 border-t border-[#f0ede4]">
          <span className="font-mono text-xs text-[#6b6470]">
            {MODE_LABEL[mode] ?? 'Circle'}
            {cycleStarted && (
              <span className="text-[#c9a15c]"> · {roundsDone}/{seats} rounds done</span>
            )}
          </span>
          <span className={`text-sm font-semibold inline-flex items-center gap-1.5 ${claimable > 0n ? 'text-[#c9a15c]' : 'text-[#0b0b0e]'}`}>
            {actionLabel} <span aria-hidden>→</span>
          </span>
        </div>
      </div>
    </Link>
  );
}
