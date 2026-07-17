/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';
import { useEffect, useState, useCallback } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { circleAbi } from '@/lib/contracts';
import { publicClient } from '@/lib/wallet';
import { useMember } from '@/lib/member';
import { computeCommitment, secretToSalt, checkRevealWillSucceed } from '@/lib/commitment';
import { ensureStableAllowance, stableBalance } from '@/lib/erc20';
import { claimFaucet } from '@/lib/faucet';
import { apiUrl } from '@/lib/api';
import { validateInvite, consumeInvite, type ValidateResult } from '@/lib/invites';
import { AuthGate } from '@/components/AuthGate';
import { InvitePanel } from '@/components/InvitePanel';
import { Button, Card, Eyebrow, PhaseBadge, SeatRing, SectionLabel, truncate } from '@/components/ui';

const STATE_NAMES = ['FILLING','ACTIVE','ABORTED_FILLING','COMMIT','REVEAL','DRAW','PAYOUT','COMPLETED','STALLED'] as const;
type StateName = typeof STATE_NAMES[number];

const INPUT_CLS =
  'w-full border border-[#e6e2d9] rounded-sm px-3 py-2.5 text-sm font-mono bg-white focus:outline-none focus:border-[#c9a15c]';

interface CircleViewProps {
  circleAddress: `0x${string}`;
  inviteToken?: string;
}

export function CircleView({ circleAddress, inviteToken }: CircleViewProps) {
  // Single source of truth for the member's on-chain identity + how their txs
  // are sent. Never read a wallet address any other way here — see lib/member.ts.
  const { address: userAddress, write } = useMember();
  const { getAccessToken } = usePrivy();
  const [inviteState, setInviteState] = useState<ValidateResult | null>(null);
  const [consumed, setConsumed] = useState(false);

  const [state, setState] = useState<number | null>(null);
  const [seats, setSeats] = useState<number>(0);
  const [members, setMembers] = useState<string[]>([]);
  const [contribution, setContribution] = useState<bigint>(0n);
  const [bond, setBond] = useState<bigint>(0n);
  const [balance, setBalance] = useState<bigint>(0n);
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
      const [stateVal, seatsVal, memberCountVal, contributionVal, bondVal, roundVal] = await Promise.all([
        publicClient.readContract({ address: circleAddress, abi: circleAbi as any, functionName: 'state' }),
        publicClient.readContract({ address: circleAddress, abi: circleAbi as any, functionName: 'seats' }),
        publicClient.readContract({ address: circleAddress, abi: circleAbi as any, functionName: 'memberCount' }),
        publicClient.readContract({ address: circleAddress, abi: circleAbi as any, functionName: 'contribution' }),
        publicClient.readContract({ address: circleAddress, abi: circleAbi as any, functionName: 'bond' }),
        publicClient.readContract({ address: circleAddress, abi: circleAbi as any, functionName: 'currentRound' }).catch(() => 0),
      ]);

      setState(Number(stateVal));
      setSeats(Number(seatsVal));
      setContribution(BigInt(contributionVal as any));
      setBond(BigInt(bondVal as any));
      setRound(Number(roundVal));

      const count = Number(memberCountVal);
      const memberList: string[] = [];
      for (let i = 0; i < count; i++) {
        const m = await publicClient.readContract({ address: circleAddress, abi: circleAbi as any, functionName: 'members', args: [i] });
        memberList.push(m as string);
      }
      setMembers(memberList);

      if (userAddress) {
        const ch = await publicClient.readContract({ address: circleAddress, abi: circleAbi as any, functionName: 'commitmentOf', args: [userAddress] }).catch(() => '0x' + '0'.repeat(64));
        setCommitOf(ch as string);
        // memberInfo returns (joined, stakedBond, contribution, claimable)
        const info = await publicClient.readContract({ address: circleAddress, abi: circleAbi as any, functionName: 'memberInfo', args: [userAddress] }).catch(() => [false, 0n, 0n, 0n]);
        setClaimable(BigInt((info as any)[3] ?? 0n));
        const bal = await stableBalance(userAddress).catch(() => 0n);
        setBalance(bal);
      }

      // Load events from the indexed API (Postgres), NOT via getLogs — Monad's
      // RPC rejects any log query spanning >100 blocks, so a block-0→latest scan
      // always fails. The indexer worker keeps ChainEvent in sync.
      try {
        const res = await fetch(apiUrl(`/api/circles/${circleAddress}/events?take=20`));
        if (res.ok) {
          const data = (await res.json()) as {
            events: { eventName: string; payload: Record<string, unknown>; blockNumber: string }[];
          };
          setEvents(
            data.events.map(e => ({
              name: e.eventName ?? 'Event',
              args: e.payload ?? {},
              blockNumber: BigInt(e.blockNumber ?? '0'),
            })),
          );
        }
      } catch { /* ignore — event feed is non-critical */ }
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

  useEffect(() => {
    if (!inviteToken) return;
    let cancelled = false;
    validateInvite(inviteToken).then(r => { if (!cancelled) setInviteState(r); });
    return () => { cancelled = true; };
  }, [inviteToken]);

  useEffect(() => {
    if (!inviteToken || consumed) return;
    const joined = members.some(m => m.toLowerCase() === userAddress?.toLowerCase());
    if (!joined) return;
    setConsumed(true);
    getAccessToken().then(t => consumeInvite(t, inviteToken));
  }, [inviteToken, consumed, members, userAddress, getAccessToken]);

  async function doWrite(functionName: string, args: any[] = []) {
    setTxPending(true);
    setTxError(null);
    try {
      await write({ address: circleAddress, abi: circleAbi as any, functionName, args });
      await load();
    } catch (e: any) {
      setTxError(e?.shortMessage ?? e?.message ?? 'Transaction failed');
    } finally {
      setTxPending(false);
    }
  }

  /** join() and commit() both move contribution/bond, so ensure allowance first. */
  async function doWriteWithApproval(functionName: string, args: any[], needed: bigint) {
    setTxPending(true);
    setTxError(null);
    try {
      await ensureStableAllowance(write, userAddress!, circleAddress, needed);
      await write({ address: circleAddress, abi: circleAbi as any, functionName, args });
      await load();
    } catch (e: any) {
      setTxError(e?.shortMessage ?? e?.message ?? 'Transaction failed');
    } finally {
      setTxPending(false);
    }
  }

  /**
   * Reveal, but only after locally re-running the contract's own commitment
   * check. A failed reveal isn't just a wasted tx — the member then looks like a
   * no-show and can be slashed, so we refuse to send one we know will revert.
   */
  async function doReveal() {
    if (!userAddress || !secret) return;
    setTxPending(true);
    setTxError(null);
    try {
      const problem = await checkRevealWillSucceed(circleAddress, userAddress, contribution, secret);
      if (problem) { setTxError(problem); return; }
      await write({
        address: circleAddress,
        abi: circleAbi as any,
        functionName: 'reveal',
        args: [contribution, secretToSalt(secret)],
      });
      await load();
    } catch (e: any) {
      setTxError(e?.shortMessage ?? e?.message ?? 'Transaction failed');
    } finally {
      setTxPending(false);
    }
  }

  async function doFaucet() {
    setTxPending(true);
    setTxError(null);
    try {
      await claimFaucet(write, userAddress!);
      await load();
    } catch (e: any) {
      setTxError(e?.shortMessage ?? e?.message ?? 'Faucet failed');
    } finally {
      setTxPending(false);
    }
  }

  /**
   * Commit hash MUST match the contract: keccak256(abi.encodePacked(amount, salt, msg.sender)).
   * For LUCKY_DRAW the revealed amount must equal the contribution, so we commit
   * to `contribution` as the amount and the user's secret (as bytes32) as the salt.
   */
  function computeHash() {
    if (!userAddress || !secret) return;
    try {
      setComputedHash(computeCommitment(contribution, secret, userAddress));
    } catch {
      setTxError('Invalid secret — must be a whole number');
    }
  }

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12 animate-pulse space-y-4">
        <div className="h-8 bg-white/60 border border-[#e6e2d9] rounded-sm w-60" />
        <div className="h-40 bg-white/60 border border-[#e6e2d9] rounded-sm" />
        <div className="h-40 bg-white/60 border border-[#e6e2d9] rounded-sm" />
      </div>
    );
  }

  const stateName: StateName = state !== null ? (STATE_NAMES[state] ?? 'FILLING') : 'FILLING';
  const isMember = members.some(m => m.toLowerCase() === userAddress?.toLowerCase());
  const hasCommitted = commitOf !== '0x' + '0'.repeat(64);
  const pot = (Number(contribution) / 1e6) * seats;

  const phaseForBadge = (() => {
    if (stateName === 'ABORTED_FILLING') return 'ABORTED';
    if (stateName === 'PAYOUT') return 'COMPLETED';
    return stateName;
  })();

  return (
    <AuthGate
      title={inviteState?.valid ? 'You’re invited — sign in to join' : 'Sign in to join this circle'}
      blurb={
        inviteState?.valid
          ? 'Someone invited you to this savings circle. Sign in (we create your wallet) and you’ll land right on the join step.'
          : "You'll need a wallet to join, commit, and claim. Signing in creates one for you."
      }
    >
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-14 space-y-6">
      {inviteState && !inviteState.valid && (
        <div className="text-sm text-[#9a4a3a] bg-[#f3e3e0] border border-[#e8cfc9] rounded-sm px-4 py-3">
          {inviteState.reason === 'full'
            ? 'This circle is now full — the invite link is no longer active.'
            : 'This invite link is no longer valid, but you can still view the circle below.'}
        </div>
      )}
      {inviteState?.valid && (
        <div className="text-sm text-[#3a6d4a] bg-[#e6efe8] border border-[#cfe0d3] rounded-sm px-4 py-3">
          You’ve been invited to this circle. Join below to claim your seat.
        </div>
      )}
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-3">
            <Eyebrow>Circle</Eyebrow>
            <span className="font-mono text-xs text-[#6b6470]">{truncate(circleAddress)}</span>
          </div>
          <h1 className="font-display font-semibold text-4xl sm:text-5xl leading-none mt-3">
            {pot.toFixed(2)} <span className="text-lg text-[#6b6470] font-sans font-medium">mUSDC pot</span>
          </h1>
          <div className="flex items-center gap-3 mt-3">
            <PhaseBadge phase={phaseForBadge} />
            {round > 0 && <span className="font-mono text-xs text-[#6b6470]">Round {round}</span>}
          </div>
        </div>
        <button onClick={() => load()} className="text-sm text-[#6b6470] hover:text-[#0b0b0e] border border-[#e6e2d9] hover:border-[#0b0b0e] px-3 py-1.5 rounded-sm transition-colors">
          Refresh
        </button>
      </div>

      {/* Seats */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <Eyebrow muted>Seats</Eyebrow>
          <span className="font-mono text-xs text-[#6b6470]">{members.length} / {seats}</span>
        </div>
        <SeatRing filled={members.length} total={seats} />
        <div className="mt-4 text-sm text-[#6b6470]">
          Contribution <span className="font-medium text-[#0b0b0e]">{(Number(contribution) / 1e6).toFixed(2)} mUSDC</span> / round
        </div>
      </Card>

      {stateName === 'FILLING' && <InvitePanel circleAddress={circleAddress} />}

      {/* Members */}
      <div>
        <SectionLabel>Members</SectionLabel>
        {members.length === 0 ? (
          <p className="text-sm text-[#6b6470]">No members yet.</p>
        ) : (
          <ul className="space-y-2">
            {members.map((m, i) => {
              const isYou = m.toLowerCase() === userAddress?.toLowerCase();
              return (
                <li key={i} className="flex items-center justify-between text-sm border border-[#e6e2d9] rounded-sm px-3 py-2.5 bg-white">
                  <span className="font-mono text-[#0b0b0e]">{truncate(m)}</span>
                  <div className="flex gap-2 items-center">
                    {isYou && <span className="font-mono text-[10px] tracking-[0.12em] uppercase bg-[#f0ead8] text-[#8a6d2f] px-2 py-1 rounded-sm">You</span>}
                    {stateName === 'COMMIT' && isYou && (
                      <span className={`font-mono text-[10px] tracking-[0.12em] uppercase px-2 py-1 rounded-sm ${hasCommitted ? 'bg-[#e6efe8] text-[#3a6d4a]' : 'bg-[#efece5] text-[#6b6470]'}`}>
                        {hasCommitted ? 'Committed' : 'Pending'}
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
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <Eyebrow muted>Your turn</Eyebrow>
          {userAddress && (
            <div className="flex items-center gap-3 text-xs">
              <span className="text-[#6b6470]">
                Balance <span className="font-medium text-[#0b0b0e]">{(Number(balance) / 1e6).toFixed(2)} mUSDC</span>
              </span>
              <button
                onClick={doFaucet}
                disabled={txPending}
                className="text-[#c9a15c] border-b border-[#c9a15c] pb-px hover:opacity-70 disabled:opacity-40"
              >
                {txPending ? '…' : 'Get funds'}
              </button>
            </div>
          )}
        </div>

        {stateName === 'FILLING' ? (
          isMember ? (
            <p className="text-sm text-[#6b6470]">You've joined. Waiting for all seats to fill.</p>
          ) : (
            <Button onClick={() => doWriteWithApproval('join', [], bond)} disabled={txPending}>
              {txPending ? 'Joining…' : 'Join circle'}
            </Button>
          )
        ) : stateName === 'COMMIT' ? (
          isMember ? (
            hasCommitted ? (
              <p className="text-sm text-[#3a6d4a] font-medium">Committed this round. Wait for the reveal phase.</p>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-[#6b6470] mb-1.5">Secret number — save it, you'll need it to reveal</label>
                  <input
                    type="number"
                    value={secret}
                    onChange={e => { setSecret(e.target.value); setComputedHash(null); }}
                    placeholder="e.g. 123456"
                    className={INPUT_CLS}
                  />
                </div>
                {secret && (
                  <button onClick={computeHash} className="text-sm text-[#c9a15c] border-b border-[#c9a15c] pb-px hover:opacity-70">
                    Compute commit hash
                  </button>
                )}
                {computedHash && (
                  <div className="bg-[#f0ead8]/50 border border-[#e6e2d9] rounded-sm p-3">
                    <div className="font-mono text-[10px] tracking-[0.12em] uppercase text-[#6b6470] mb-1">Commit hash</div>
                    <div className="font-mono text-xs text-[#0b0b0e] break-all">{computedHash}</div>
                  </div>
                )}
                <Button
                  onClick={() => computedHash && doWriteWithApproval('commit', [computedHash as `0x${string}`], contribution)}
                  disabled={txPending || !computedHash}
                >
                  {txPending ? 'Committing…' : 'Commit'}
                </Button>
              </div>
            )
          ) : (
            <p className="text-sm text-[#6b6470]">You are not a member of this circle.</p>
          )
        ) : stateName === 'REVEAL' ? (
          isMember ? (
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-[#6b6470] mb-1.5">Your secret number</label>
                <input
                  type="number"
                  value={secret}
                  onChange={e => setSecret(e.target.value)}
                  placeholder="Enter the secret you committed"
                  className={INPUT_CLS}
                />
              </div>
              <Button onClick={doReveal} disabled={txPending || !secret}>
                {txPending ? 'Revealing…' : 'Reveal'}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-[#6b6470]">You are not a member of this circle.</p>
          )
        ) : stateName === 'DRAW' ? (
          <div className="flex items-center gap-3 text-[#6b6470]">
            <span className="h-5 w-5 rounded-full border-2 border-[#c9a15c] border-t-transparent animate-spin" />
            <span className="text-sm">Pyth is drawing the winner from verifiable randomness…</span>
          </div>
        ) : stateName === 'PAYOUT' || stateName === 'COMPLETED' ? (
          claimable > 0n ? (
            <div className="space-y-3">
              <p className="text-sm text-[#6b6470]">
                Claimable <span className="font-display font-semibold text-lg text-[#c9a15c]">{(Number(claimable) / 1e6).toFixed(2)} mUSDC</span>
              </p>
              <Button variant="brass" onClick={() => doWrite('claim')} disabled={txPending}>
                {txPending ? 'Claiming…' : 'Claim payout'}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-[#6b6470]">Nothing to claim right now.</p>
          )
        ) : stateName === 'STALLED' ? (
          <div className="space-y-3">
            <p className="text-sm text-[#9a4a3a]">This circle stalled — the draw didn't complete in time. You can reclaim your funds.</p>
            <Button variant="ghost" onClick={() => doWrite('reclaimOnStall')} disabled={txPending}>
              {txPending ? 'Reclaiming…' : 'Reclaim funds'}
            </Button>
          </div>
        ) : stateName === 'ABORTED_FILLING' ? (
          <div className="space-y-3">
            <p className="text-sm text-[#9a4a3a]">This circle was aborted during filling. You can get a full refund.</p>
            <Button variant="ghost" onClick={() => doWrite('refundFilling')} disabled={txPending}>
              {txPending ? 'Refunding…' : 'Get refund'}
            </Button>
          </div>
        ) : (
          <p className="text-sm text-[#6b6470]">No actions available in this phase.</p>
        )}

        {txError && (
          <div className="mt-4 text-sm text-[#9a4a3a] bg-[#f3e3e0] border border-[#e8cfc9] rounded-sm px-3 py-2.5">
            {txError}
          </div>
        )}
      </Card>

      {/* Event feed */}
      {events.length > 0 && (
        <div>
          <SectionLabel>Recent activity</SectionLabel>
          <ul className="space-y-1.5">
            {events.map((ev, i) => (
              <li key={i} className="text-xs text-[#6b6470] font-mono flex gap-3">
                <span className="text-[#c9a15c]">[{ev.blockNumber.toString()}]</span>
                <span>{ev.name}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
    </AuthGate>
  );
}
