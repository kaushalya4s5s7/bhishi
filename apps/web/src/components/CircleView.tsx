/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { circleAbi } from '@/lib/contracts';
import { publicClient } from '@/lib/wallet';
import { useMember } from '@/lib/member';
import { computeCommitment, secretToSalt, checkRevealWillSucceed } from '@/lib/commitment';
import { ensureStableAllowance, stableBalance } from '@/lib/erc20';
import { claimFaucet } from '@/lib/faucet';
import { apiUrl } from '@/lib/api';
import { fetchCircleDetail } from '@/lib/circle';
import { confirmTransaction } from '@/lib/transactions';
import { formatTxError } from '@/lib/txError';
import { validateInvite, consumeInvite, type ValidateResult } from '@/lib/invites';
import { fetchProfile, memberLabel, type UserProfile } from '@/lib/profile';
import { AuthGate } from '@/components/AuthGate';
import { InvitePanel } from '@/components/InvitePanel';
import { Avatar, Button, Eyebrow, PhaseBadge, SeatRing, truncate } from '@/components/ui';

const STATE_NAMES = ['FILLING','ACTIVE','ABORTED_FILLING','COMMIT','REVEAL','DRAW','PAYOUT','COMPLETED','STALLED'] as const;
type StateName = typeof STATE_NAMES[number];

const INPUT_CLS =
  'w-full border border-[#e6e2d9] rounded-sm px-3 py-2.5 text-sm font-mono bg-white focus:outline-none focus:border-[#c9a15c]';

/** Monad testnet explorer tx link. */
const txUrl = (hash: string) => `https://testnet.monadexplorer.com/tx/${hash}`;

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
  // Tracks whether we've observed a genuine "not a member" -> "member" transition
  // during THIS session, as opposed to the user simply already being a member on
  // the very first load (e.g. opening their own reusable invite link, or a
  // forwarded invite after joining some other way). `null` means "we haven't
  // established a baseline yet" (data hasn't loaded); once set, it's the
  // membership state we most recently observed.
  const wasMemberRef = useRef<boolean | null>(null);
  // Tracks the last (round, memberCount) pair we already attempted
  // advanceToReveal() for, so the 10s poll doesn't re-issue the same batch of
  // `committed()` reads forever once we've already established the answer for
  // this round — only a NEW round or a newly-joined/committed member can
  // change the outcome, so re-checking anything else is wasted RPC traffic.
  const advanceCheckedRef = useRef<string | null>(null);
  // Same idea, for requestDraw() — keyed only by round, since once requested
  // for a round, drawRequestedAt itself makes any further call a cheap no-op
  // via tryRequestDraw's own check (no need to re-derive that from state here).
  const drawRequestedCheckedRef = useRef<number | null>(null);

  const [state, setState] = useState<number | null>(null);
  const [mode, setMode] = useState<'LUCKY_DRAW' | 'AUCTION'>('LUCKY_DRAW');
  const [seats, setSeats] = useState<number>(0);
  const [members, setMembers] = useState<string[]>([]);
  // Lowercased addresses that have won ANY past round (from the indexer's
  // hasWon flag). Used to label a claimable balance correctly: a past winner's
  // claimable is their pot winnings, not a dividend, even after the round moved on.
  const [wonMembers, setWonMembers] = useState<Set<string>>(new Set());
  const [profiles, setProfiles] = useState<Record<string, UserProfile | null>>({});
  const [contribution, setContribution] = useState<bigint>(0n);
  const [bond, setBond] = useState<bigint>(0n);
  const [balance, setBalance] = useState<bigint>(0n);
  const [commitOf, setCommitOf] = useState<string>('0x' + '0'.repeat(64));
  const [claimable, setClaimable] = useState<bigint>(0n);
  const [revealed, setRevealed] = useState(false);
  const [round, setRound] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [txPending, setTxPending] = useState(false);
  const [txError, setTxError] = useState<string | null>(null);
  const [secret, setSecret] = useState('');
  // AUCTION only: the discount (in whole mUSDC) the member bids — how much of
  // the pot they'll forgo to win it early. Empty in LUCKY_DRAW (unused there).
  const [bid, setBid] = useState('');
  // This round's pot (sum of contributions), read live — used to show and
  // enforce the 40%-of-pot bid cap (Circle.sol MAX_BID_DISCOUNT_BPS = 4000).
  const [roundPool, setRoundPool] = useState<bigint>(0n);
  const [computedHash, setComputedHash] = useState<string | null>(null);
  const [events, setEvents] = useState<{ name: string; args: Record<string, any>; blockNumber: bigint; txHash: string }[]>([]);
  // Optimistic feed entries for the user's OWN just-confirmed actions. The
  // indexed /events feed lags by up to ~20s (indexer polls the chain every
  // ~10s, then the UI polls the API every ~10s), so without this the user
  // wouldn't see their own commit/reveal/claim in "Recent activity" for a
  // while. Each entry drops itself once the indexed feed contains its txHash.
  const [pendingEvents, setPendingEvents] = useState<{ name: string; txHash: string }[]>([]);

  function addPendingEvent(name: string, txHash: string) {
    if (!txHash) return;
    setPendingEvents(prev =>
      prev.some(p => p.txHash.toLowerCase() === txHash.toLowerCase()) ? prev : [{ name, txHash }, ...prev],
    );
  }

  // ── FAST PATH ──────────────────────────────────────────────────────────
  // Circle display data from the indexed API (Postgres, ~40ms) instead of 3+
  // sequential Monad-RPC round-trips (~1.5s each). This is what clears the
  // skeleton and paints the page. `state`, `round`, `members` etc. come from
  // the indexer, which stays a beat behind chain — good enough to DISPLAY;
  // anything a user ACTS on is re-verified live in loadLive() below.
  const loadFromApi = useCallback(async () => {
    try {
      const [detail, eventsRes] = await Promise.all([
        fetchCircleDetail(circleAddress),
        fetch(apiUrl(`/api/circles/${circleAddress}/events?take=20`)).then(r => (r.ok ? r.json() : { events: [] })).catch(() => ({ events: [] })),
      ]);

      const memberList = detail.members.map(m => m.address);
      setWonMembers(new Set(detail.members.filter(m => m.hasWon).map(m => m.address.toLowerCase())));
      const stateIdx = STATE_NAMES.indexOf(detail.state as StateName);
      setState(stateIdx === -1 ? 0 : stateIdx);
      setMode(detail.mode);
      setSeats(detail.seats);
      setContribution(BigInt(detail.contribution));
      setBond(BigInt(detail.bond));
      setRound(detail.currentRound);
      setMembers(memberList);
      const indexed = (eventsRes.events as { eventName: string; payload: Record<string, unknown>; blockNumber: string; txHash: string }[]).map(e => ({
        name: e.eventName ?? 'Event',
        args: e.payload ?? {},
        blockNumber: BigInt(e.blockNumber ?? '0'),
        txHash: e.txHash ?? '',
      }));
      setEvents(indexed);
      // Drop any optimistic entry the indexer has now caught up on.
      const indexedHashes = new Set(indexed.map(e => e.txHash.toLowerCase()));
      setPendingEvents(prev => prev.filter(p => !indexedHashes.has(p.txHash.toLowerCase())));
    } catch (e) {
      // If the API can't serve it (e.g. brand-new circle not indexed yet),
      // loadLive() still fills everything from chain — just a touch slower.
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [circleAddress]);

  // ── FRESHNESS PATH ─────────────────────────────────────────────────────
  // Refresh live from the contract in the background: the fields an action
  // depends on (a member's own commit/reveal/claim state + wallet balance)
  // MUST be current, so a button never fires on stale indexer data. Also
  // re-reads circle state/round/members so a just-changed phase reflects
  // before the indexer catches up. Non-blocking — the page is already painted
  // from loadFromApi(), this only corrects/sharpens it.
  const loadLive = useCallback(async () => {
    try {
      const [stateVal, memberCountVal, roundVal, roundPoolVal, bondVal] = await Promise.all([
        publicClient.readContract({ address: circleAddress, abi: circleAbi as any, functionName: 'state' }),
        publicClient.readContract({ address: circleAddress, abi: circleAbi as any, functionName: 'memberCount' }),
        publicClient.readContract({ address: circleAddress, abi: circleAbi as any, functionName: 'currentRound' }).catch(() => 0),
        publicClient.readContract({ address: circleAddress, abi: circleAbi as any, functionName: 'roundPool' }).catch(() => 0n),
        // bond is immutable on the contract, but the Join button's approval
        // amount depends on it — if the indexer hasn't caught this circle yet,
        // loadFromApi() never calls setBond(), and join() would otherwise fire
        // with bond=0, skip the approve, and revert with InsufficientAllowance.
        publicClient.readContract({ address: circleAddress, abi: circleAbi as any, functionName: 'bond' }).catch(() => null),
      ]);
      setRoundPool(BigInt(roundPoolVal as any));
      if (bondVal !== null) setBond(BigInt(bondVal as any));

      const count = Number(memberCountVal);
      const memberList = (
        await Promise.all(
          Array.from({ length: count }, (_, i) =>
            publicClient.readContract({ address: circleAddress, abi: circleAbi as any, functionName: 'members', args: [i] }),
          ),
        )
      ) as string[];

      // advanceToReveal() / requestDraw() are permissionless but nothing calls
      // them automatically — kick them here once per (round, memberCount) /
      // round so a stuck circle never sits in COMMIT/DRAW forever. See each
      // helper's doc comment.
      const advanceCheckKey = `${Number(roundVal)}:${count}`;
      if (userAddress && Number(stateVal) === STATE_NAMES.indexOf('COMMIT') && advanceCheckedRef.current !== advanceCheckKey) {
        advanceCheckedRef.current = advanceCheckKey;
        void tryAdvanceToReveal(memberList);
      }
      if (userAddress && Number(stateVal) === STATE_NAMES.indexOf('DRAW') && drawRequestedCheckedRef.current !== Number(roundVal)) {
        drawRequestedCheckedRef.current = Number(roundVal);
        void tryRequestDraw();
      }

      let nextCommitOf: string = '0x' + '0'.repeat(64);
      let nextClaimable = 0n;
      let nextBalance = 0n;
      let nextRevealed = false;
      if (userAddress) {
        const [ch, info, bal, hasRevealed] = await Promise.all([
          publicClient.readContract({ address: circleAddress, abi: circleAbi as any, functionName: 'commitmentOf', args: [userAddress] }).catch(() => '0x' + '0'.repeat(64)),
          // memberInfo returns (joined, stakedBond, contribution, claimable)
          publicClient.readContract({ address: circleAddress, abi: circleAbi as any, functionName: 'memberInfo', args: [userAddress] }).catch(() => [false, 0n, 0n, 0n]),
          stableBalance(userAddress).catch(() => 0n),
          publicClient.readContract({ address: circleAddress, abi: circleAbi as any, functionName: 'revealed', args: [userAddress] }).catch(() => false),
        ]);
        nextCommitOf = ch as string;
        nextClaimable = BigInt((info as any)[3] ?? 0n);
        nextBalance = bal;
        nextRevealed = Boolean(hasRevealed);
      }

      // Commit together so the render never mixes a fresh field with a stale one.
      setState(Number(stateVal));
      setRound(Number(roundVal));
      setMembers(memberList);
      setCommitOf(nextCommitOf);
      setClaimable(nextClaimable);
      setBalance(nextBalance);
      setRevealed(nextRevealed);
    } catch (e) {
      console.error(e);
    }
  }, [circleAddress, userAddress]);

  // After a user's own tx, refresh both paths. loadLive() is what the action
  // buttons care about (their own commit/reveal/claim state), so it's awaited;
  // the API refresh runs alongside to catch indexer-derived fields.
  const refresh = useCallback(async () => {
    await Promise.all([loadFromApi(), loadLive()]);
  }, [loadFromApi, loadLive]);

  useEffect(() => {
    // Paint instantly from the API, then sharpen from chain — and keep both
    // fresh on a 10s poll (API is cheap; the live refresh is what guarantees
    // action state is current).
    loadFromApi();
    loadLive();
    const interval = setInterval(() => {
      loadFromApi();
      loadLive();
    }, 10000);
    return () => clearInterval(interval);
  }, [loadFromApi, loadLive]);

  useEffect(() => {
    if (!inviteToken) return;
    let cancelled = false;
    validateInvite(inviteToken).then(r => { if (!cancelled) setInviteState(r); });
    return () => { cancelled = true; };
  }, [inviteToken]);

  useEffect(() => {
    // Wait until we actually have loaded member data and know the user's address —
    // an empty `members` array pre-load must never be mistaken for "not a member".
    if (loading || !userAddress) return;
    const isMemberNow = members.some(m => m.toLowerCase() === userAddress.toLowerCase());

    if (wasMemberRef.current === null) {
      // First observation after data has loaded: this establishes the baseline,
      // it is NOT a transition. If they're already a member on first look (own
      // reusable link, forwarded invite after joining elsewhere, etc.), we must
      // not attribute that as a fresh join.
      wasMemberRef.current = isMemberNow;
      return;
    }

    const justJoined = !wasMemberRef.current && isMemberNow;
    wasMemberRef.current = isMemberNow;

    if (!inviteToken || consumed || !justJoined) return;
    // Best-effort attribution only: consumeInvite (lib/invites.ts) intentionally
    // swallows all errors and never rejects, so there is no success/failure signal
    // to react to here. Given consume is explicitly non-critical (it only affects
    // who gets attribution credit for an invite, never the on-chain join itself),
    // a single fire-and-forget attempt is the pragmatic choice — building a retry
    // system around a best-effort side channel would be over-engineering. We mark
    // `consumed` immediately so we don't refire on every subsequent render.
    setConsumed(true);
    getAccessToken().then(t => consumeInvite(t, inviteToken));
  }, [inviteToken, consumed, members, userAddress, loading, getAccessToken]);

  // Resolve each member's display name/email for the member list, so it never
  // just shows a raw address. Fetches only addresses not already in `profiles`.
  useEffect(() => {
    const missing = members.filter(m => !(m.toLowerCase() in profiles));
    if (missing.length === 0) return;
    let cancelled = false;
    Promise.all(missing.map(async m => [m.toLowerCase(), await fetchProfile(m)] as const)).then(entries => {
      if (cancelled) return;
      setProfiles(prev => ({ ...prev, ...Object.fromEntries(entries) }));
    });
    return () => {
      cancelled = true;
    };
  }, [members, profiles]);

  // Map a function we call to the event name it emits, so an optimistic feed
  // entry reads like the real indexed one.
  const EVENT_FOR_FN: Record<string, string> = {
    claim: 'Claimed', join: 'Joined', commit: 'Committed', reveal: 'Revealed',
    reclaimOnStall: 'Stalled', refundFilling: 'FillingRefunded',
  };

  async function doWrite(functionName: string, args: any[] = []) {
    setTxPending(true);
    setTxError(null);
    try {
      const hash = await write({ address: circleAddress, abi: circleAbi as any, functionName, args });
      addPendingEvent(EVENT_FOR_FN[functionName] ?? functionName, hash);
      await refresh();
    } catch (e: any) {
      setTxError(formatTxError(e));
    } finally {
      setTxPending(false);
    }
  }

  /**
   * Check (via one batched multicall — see lib/wallet.ts's batch.multicall)
   * whether every joined member has now committed, and if so, fire the
   * permissionless advanceToReveal() so the circle actually enters REVEAL.
   * Best-effort: if someone else beats us to it, or a read fails, this just
   * silently no-ops — the circle will simply wait for the next committer (or
   * a future poll) to try again rather than surface an error to this user.
   */
  async function tryAdvanceToReveal(memberList: string[] = members) {
    try {
      const committedFlags = await Promise.all(
        memberList.map(m =>
          publicClient.readContract({ address: circleAddress, abi: circleAbi as any, functionName: 'committed', args: [m] }),
        ),
      );
      const allCommitted = committedFlags.every(Boolean);
      if (!allCommitted) return;
      await write({ address: circleAddress, abi: circleAbi as any, functionName: 'advanceToReveal', args: [] });
    } catch {
      // Someone else likely already advanced it, or the circle isn't ready —
      // either way, not an error worth surfacing to this user.
    }
  }

  /**
   * requestDraw() is ALSO permissionless, and — same gap as advanceToReveal —
   * nothing calls it automatically. Without this, a circle that enters DRAW
   * state has NO path forward at all: requestDraw() is what actually asks
   * Pyth Entropy for randomness (entropyCallback picks the winner from that),
   * and reclaimOnStall() (the timeout safety valve) itself requires
   * drawRequestedAt != 0 before its VRF_TIMEOUT clock can even start. So
   * skipping this call doesn't just delay the draw — it strands the circle
   * with no recovery path. Checking drawRequestedAt first avoids a guaranteed
   * DrawAlreadyRequested() revert once someone else has already called it.
   */
  async function tryRequestDraw() {
    try {
      const requestedAt = await publicClient.readContract({
        address: circleAddress, abi: circleAbi as any, functionName: 'drawRequestedAt',
      });
      if (BigInt(requestedAt as bigint) !== 0n) return;
      await write({ address: circleAddress, abi: circleAbi as any, functionName: 'requestDraw', args: [] });
    } catch {
      // Someone else likely already requested it — not worth surfacing.
    }
  }

  /** join() and commit() both move contribution/bond, so ensure allowance first. */
  async function doWriteWithApproval(functionName: string, args: any[], needed: bigint) {
    setTxPending(true);
    setTxError(null);
    try {
      await ensureStableAllowance(write, userAddress!, circleAddress, needed);
      const hash = await write({ address: circleAddress, abi: circleAbi as any, functionName, args });
      addPendingEvent(EVENT_FOR_FN[functionName] ?? functionName, hash);
      // Fast-path: tell the backend this confirmed so the dashboard/circle
      // page reflect it immediately instead of waiting for the indexer's next
      // poll. Best-effort — the indexer reconciles the same data regardless.
      if (functionName === 'join' || functionName === 'commit') {
        confirmTransaction(await getAccessToken(), hash, functionName);
      }
      // advanceToReveal() is permissionless but nobody calls it automatically
      // on-chain — commit() only records the commitment, it never flips the
      // phase itself. Without this, a circle sits in COMMIT forever once
      // everyone has committed, waiting for a manual tx that never comes.
      // Whoever commits last is the natural moment to check and trigger it.
      if (functionName === 'commit') {
        await tryAdvanceToReveal();
      }
      await refresh();
    } catch (e: any) {
      setTxError(formatTxError(e));
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
    // In AUCTION the revealed amount is the bid — it MUST byte-for-byte match
    // what was committed, so the user re-enters the same bid here.
    if (mode === 'AUCTION' && !bidValid) {
      setTxError(`Enter the same bid you committed (0–${maxBidMusdc.toFixed(2)} mUSDC).`);
      return;
    }
    const amount = mode === 'AUCTION' ? bidUnits : contribution;
    setTxPending(true);
    setTxError(null);
    try {
      const problem = await checkRevealWillSucceed(circleAddress, userAddress, amount, secret);
      if (problem) { setTxError(problem); return; }
      const hash = await write({
        address: circleAddress,
        abi: circleAbi as any,
        functionName: 'reveal',
        args: [amount, secretToSalt(secret)],
      });
      addPendingEvent('Revealed', hash);
      confirmTransaction(await getAccessToken(), hash, 'reveal');
      await refresh();
    } catch (e: any) {
      setTxError(formatTxError(e));
    } finally {
      setTxPending(false);
    }
  }

  async function doFaucet() {
    setTxPending(true);
    setTxError(null);
    try {
      await claimFaucet(write, userAddress!);
      await refresh();
    } catch (e: any) {
      setTxError(formatTxError(e, 'Faucet failed'));
    } finally {
      setTxPending(false);
    }
  }

  /**
   * Commit hash MUST match the contract: keccak256(abi.encodePacked(amount, salt, msg.sender)).
   *  • LUCKY_DRAW: the revealed amount must equal `contribution`, so we commit
   *    to `contribution`.
   *  • AUCTION: the amount IS the member's bid discount, so we commit to
   *    `bidUnits`. The member must re-enter the SAME bid + secret at reveal.
   */
  function computeHash() {
    if (!userAddress || !secret) return;
    if (mode === 'AUCTION' && !bidValid) {
      setTxError(`Enter a bid between 0 and ${maxBidMusdc.toFixed(2)} mUSDC (max 40% of the pot).`);
      return;
    }
    try {
      const amount = mode === 'AUCTION' ? bidUnits : contribution;
      setComputedHash(computeCommitment(amount, secret, userAddress));
    } catch {
      setTxError('Invalid secret — must be a whole number');
    }
  }

  // Show the skeleton until we have a REAL loaded snapshot (state !== null),
  // not just until `loading` flips. `loading` alone can desync — e.g. the
  // wallet address resolving a tick after mount re-runs load() while the
  // initial zero-state (seats:0, contribution:0n → "0.00 pot") is momentarily
  // on screen. Gating on `state === null` guarantees the very first frame the
  // user sees already carries real values, never the zero defaults.
  if (loading || state === null) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-8 sm:pt-10 pb-14 animate-pulse space-y-4">
        <div className="h-8 bg-white/60 rounded-full w-60" />
        <div className="h-40 bg-white/60 rounded-2xl" />
        <div className="h-40 bg-white/60 rounded-2xl" />
      </div>
    );
  }

  const stateName: StateName = state !== null ? (STATE_NAMES[state] ?? 'FILLING') : 'FILLING';

  // The most recent WinnerDrawn event overall — shown persistently (even after
  // a new round has started and `round` has moved on) so the winner is never
  // just buried in the raw activity feed below.
  const lastWinnerDrawnEvent = events
    .filter(ev => ev.name === 'WinnerDrawn')
    .sort((a, b) => Number(b.blockNumber - a.blockNumber))[0];
  const lastWinnerRound = lastWinnerDrawnEvent ? Number(lastWinnerDrawnEvent.args.round ?? -1) : -1;
  const lastWinnerAddress =
    typeof lastWinnerDrawnEvent?.args.winner === 'string' ? lastWinnerDrawnEvent.args.winner : undefined;
  const lastWinnerTxHash = lastWinnerDrawnEvent?.txHash;
  const iAmLastWinner =
    Boolean(lastWinnerAddress) && userAddress && lastWinnerAddress!.toLowerCase() === userAddress.toLowerCase();
  // The winner's payout lands in the SAME wallet they play with — claim() does
  // safeTransfer(msg.sender), and msg.sender is useMember().address. Surface it
  // so the winner knows exactly which address receives the funds.
  const myClaimTxHash = events.find(ev => ev.name === 'Claimed' && typeof ev.args.member === 'string' && userAddress && (ev.args.member as string).toLowerCase() === userAddress.toLowerCase())?.txHash;

  // Whether the CURRENT PAYOUT/COMPLETED screen is for the round that winner
  // belongs to — once a new round starts, this correctly stops applying so we
  // don't tell someone "you didn't win" about a round that's no longer live.
  const didNotWinThisRound =
    Boolean(lastWinnerAddress) &&
    lastWinnerRound === round &&
    userAddress &&
    lastWinnerAddress!.toLowerCase() !== userAddress.toLowerCase();
  const isMember = members.some(m => m.toLowerCase() === userAddress?.toLowerCase());
  const hasCommitted = commitOf !== '0x' + '0'.repeat(64);
  const pot = (Number(contribution) / 1e6) * seats;
  const isAuction = mode === 'AUCTION';

  // AUCTION bid derivations. The bid (discount) is capped at 40% of THIS
  // round's live pool (Circle.sol MAX_BID_DISCOUNT_BPS). We validate the typed
  // bid against that cap so we never send a reveal the contract will reject
  // with BidExceedsCap. `bidUnits` is the on-chain 6-decimal value; the
  // `amount` committed/revealed must be identical at commit and reveal.
  const maxBidUnits = (roundPool * 4000n) / 10000n; // 40% of the pool, in base units
  const maxBidMusdc = Number(maxBidUnits) / 1e6;
  const bidNum = bid.trim() === '' ? NaN : Number(bid);
  const bidUnits = Number.isFinite(bidNum) ? BigInt(Math.round(bidNum * 1e6)) : 0n;
  const bidValid = Number.isFinite(bidNum) && bidNum >= 0 && bidUnits <= maxBidUnits;

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
    <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-8 sm:pt-10 pb-14">
      {inviteState && !inviteState.valid && (
        <div className="text-sm text-[#9a4a3a] bg-[#f3e3e0] border border-[#e8cfc9] rounded-2xl px-4 py-3 mb-6">
          {inviteState.reason === 'full'
            ? 'This circle is now full — the invite link is no longer active.'
            : 'This invite link is no longer valid, but you can still view the circle below.'}
        </div>
      )}
      {inviteState?.valid && isMember && (
        <div className="text-sm text-[#3a6d4a] bg-[#e6efe8] border border-[#cfe0d3] rounded-2xl px-4 py-3 mb-6">
          You’re already a member of this circle.
        </div>
      )}
      {inviteState?.valid && !isMember && (
        <div className="text-sm text-[#3a6d4a] bg-[#e6efe8] border border-[#cfe0d3] rounded-2xl px-4 py-3 mb-6">
          You’ve been invited to this circle. Join below to claim your seat.
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4 mb-6">
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
        <button onClick={() => refresh()} className="text-sm text-[#6b6470] hover:text-[#0b0b0e] border border-[#e6e2d9] hover:border-[#0b0b0e] px-3 py-1.5 rounded-full transition-colors bg-white shadow-sm">
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-6">
        {/* Main column */}
        <div className="min-w-0 space-y-6">
          {/* Last winner — persistent, so it isn't buried once a new round starts */}
          {lastWinnerAddress && (
            <div className="text-sm rounded-2xl px-5 py-4 space-y-1.5 shadow-sm" style={{ background: 'linear-gradient(135deg, #f6e3d5, #f0ead8)' }}>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span className="text-[#6b6470]">
                  Round {lastWinnerRound} winner:{' '}
                  <span className="text-[#0b0b0e] font-medium">
                    {memberLabel(profiles[lastWinnerAddress.toLowerCase()], lastWinnerAddress)}
                  </span>
                  {iAmLastWinner && <span className="text-[#c9a15c] font-semibold"> — that&rsquo;s you!</span>}
                </span>
                {lastWinnerTxHash && (
                  <a
                    href={txUrl(lastWinnerTxHash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-xs text-[#c9a15c] border-b border-[#c9a15c] pb-px hover:opacity-70"
                  >
                    View draw tx ↗
                  </a>
                )}
              </div>
              {iAmLastWinner && (
                <p className="text-xs text-[#6b6470]">
                  The pot is paid in mUSDC to your wallet{' '}
                  <span className="font-mono text-[#0b0b0e]">{truncate(userAddress!)}</span> — the same address you play with.
                  {myClaimTxHash ? (
                    <>
                      {' '}Claimed:{' '}
                      <a href={txUrl(myClaimTxHash)} target="_blank" rel="noopener noreferrer" className="text-[#c9a15c] border-b border-[#c9a15c] pb-px hover:opacity-70">
                        view claim tx ↗
                      </a>
                    </>
                  ) : (
                    <> Use the “Claim balance” action below to pull it in.</>
                  )}
                </p>
              )}
            </div>
          )}

          {/* Seats */}
          <div className="rounded-2xl bg-white shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <Eyebrow muted>Seats</Eyebrow>
              <span className="font-mono text-xs text-[#6b6470]">{members.length} / {seats}</span>
            </div>
            <SeatRing filled={members.length} total={seats} />
            <div className="mt-4 text-sm text-[#6b6470]">
              Contribution <span className="font-medium text-[#0b0b0e]">{(Number(contribution) / 1e6).toFixed(2)} mUSDC</span> / round
            </div>
          </div>

          {stateName === 'FILLING' && <InvitePanel circleAddress={circleAddress} />}

          {/* Phase action panel */}
          <div className="rounded-2xl bg-white shadow-sm p-6">
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

        {/* Claim is available in ANY state whenever there's a claimable
            balance — the contract's claim() has no phase guard. This lives
            OUTSIDE the phase ternary below: a winner in a multi-round circle
            has claimable funds while the circle has already moved on to COMMIT
            for the next round, so gating claim on PAYOUT/COMPLETED alone would
            hide it until the whole circle finished.

            IMPORTANT — this is NOT a "you won" prize banner. `claimable` is a
            single accumulated balance that can hold different things depending
            on mode/role:
             • LUCKY_DRAW: only the round winner ever accrues the pot.
             • AUCTION: EVERY member accrues a dividend each round (their equal
               share of the winner's bid discount — see Circle.sol's discount
               split), PLUS the pot if they won. So a non-winner legitimately
               has a claimable dividend.
             • Any mode: at circle completion, staked bonds are returned via
               claimable too.
            Because it can be a mix, we frame it as "your balance in this
            circle" rather than mislabeling everyone's as "winnings". */}
        {claimable > 0n && (() => {
          const amt = (Number(claimable) / 1e6).toFixed(2);
          // Fresh "you won" callout only right after this round's draw.
          const wonThisRound = iAmLastWinner && lastWinnerRound === round;
          // Have I EVER won a round? Robust across round changes — a past
          // winner's balance is winnings, not a dividend, even later on.
          const iHaveWon = Boolean(userAddress && wonMembers.has(userAddress.toLowerCase()));
          // A dividend is the only source for a member who has never won in an
          // AUCTION; if they've won, their balance mixes pot + dividends, so we
          // don't claim it's purely a dividend.
          const isPureDividend = mode === 'AUCTION' && !iHaveWon;
          return (
            <div className="mb-5 bg-[#f0ead8]/60 border border-[#c9a15c]/40 rounded-sm p-4 space-y-2">
              {wonThisRound && (
                <p className="text-sm font-semibold text-[#c9a15c]">You won this round&rsquo;s pot.</p>
              )}
              <p className="text-sm text-[#6b6470]">
                Your claimable balance:{' '}
                <span className="font-display font-semibold text-lg text-[#c9a15c]">{amt} mUSDC</span>
                {isPureDividend && (
                  <span className="text-xs"> — your dividend share of the winner&rsquo;s discount</span>
                )}
                . Paid to your wallet <span className="font-mono text-xs text-[#0b0b0e]">{truncate(userAddress!)}</span>.
              </p>
              <Button variant="brass" onClick={() => doWrite('claim')} disabled={txPending}>
                {txPending ? 'Claiming…' : 'Claim balance'}
              </Button>
            </div>
          );
        })()}

        {stateName === 'FILLING' ? (
          isMember ? (
            <p className="text-sm text-[#6b6470]">You've joined. Waiting for all seats to fill.</p>
          ) : (
            <Button
              onClick={() => {
                // bond is read from both the indexer and live chain (loadLive);
                // 0 here means neither has resolved it yet — never approve/join
                // for an unverified amount (see loadLive's bond comment).
                if (bond === 0n) {
                  setTxError('Circle details are still loading — try again in a moment.');
                  return;
                }
                doWriteWithApproval('join', [], bond);
              }}
              disabled={txPending}
            >
              {txPending ? 'Joining…' : 'Join circle'}
            </Button>
          )
        ) : stateName === 'COMMIT' ? (
          isMember ? (
            hasCommitted ? (
              <p className="text-sm text-[#3a6d4a] font-medium">Committed this round. Wait for the reveal phase.</p>
            ) : (
              <div className="space-y-4">
                {isAuction && (
                  <div>
                    <label className="block text-sm text-[#6b6470] mb-1.5">
                      Your bid — the discount (mUSDC) you&rsquo;ll give up to win the pot this round.
                      Highest bidder wins; the discount is split as a dividend to everyone. Max {maxBidMusdc.toFixed(2)} (40% of pot).
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={maxBidMusdc}
                      value={bid}
                      onChange={e => { setBid(e.target.value); setComputedHash(null); }}
                      placeholder={`0 – ${maxBidMusdc.toFixed(2)}`}
                      className={`${INPUT_CLS} ${bid !== '' && !bidValid ? 'border-[#c98a7c]' : ''}`}
                    />
                    {bid !== '' && !bidValid && (
                      <p className="text-[#9a4a3a] text-xs mt-1.5">Bid must be between 0 and {maxBidMusdc.toFixed(2)} mUSDC.</p>
                    )}
                  </div>
                )}
                <div>
                  <label className="block text-sm text-[#6b6470] mb-1.5">
                    Secret number — save it{isAuction ? ' along with your bid' : ''}, you&rsquo;ll need {isAuction ? 'both' : 'it'} to reveal
                  </label>
                  <input
                    type="number"
                    value={secret}
                    onChange={e => { setSecret(e.target.value); setComputedHash(null); }}
                    placeholder="e.g. 123456"
                    className={INPUT_CLS}
                  />
                </div>
                {secret && (!isAuction || bidValid) && (
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
            revealed ? (
              <p className="text-sm text-[#3a6d4a] font-medium">
                Already revealed. Waiting for everyone else to reveal, then the draw runs.
              </p>
            ) : (
              <div className="space-y-4">
                {isAuction && (
                  <div>
                    <label className="block text-sm text-[#6b6470] mb-1.5">Your bid (the exact discount you committed, in mUSDC)</label>
                    <input
                      type="number"
                      min={0}
                      max={maxBidMusdc}
                      value={bid}
                      onChange={e => setBid(e.target.value)}
                      placeholder="Enter the bid you committed"
                      className={`${INPUT_CLS} ${bid !== '' && !bidValid ? 'border-[#c98a7c]' : ''}`}
                    />
                  </div>
                )}
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
                {isAuction && (
                  <p className="text-xs text-[#6b6470]">
                    Both the bid and secret must match what you committed, or the reveal fails and your bond can be slashed.
                  </p>
                )}
                <Button onClick={doReveal} disabled={txPending || !secret || (isAuction && !bidValid)}>
                  {txPending ? 'Revealing…' : 'Reveal'}
                </Button>
              </div>
            )
          ) : (
            <p className="text-sm text-[#6b6470]">You are not a member of this circle.</p>
          )
        ) : stateName === 'DRAW' ? (
          <div className="flex items-center gap-3 text-[#6b6470]">
            <span className="h-5 w-5 rounded-full border-2 border-[#c9a15c] border-t-transparent animate-spin" />
            <span className="text-sm">Pyth is drawing the winner from verifiable randomness…</span>
          </div>
        ) : stateName === 'PAYOUT' || stateName === 'COMPLETED' ? (
          // The claim button (if any) is rendered by the always-visible
          // claimable banner above, so here we only handle the no-balance
          // messaging.
          claimable > 0n ? (
            <p className="text-sm text-[#3a6d4a]">The circle is complete — claim your balance above.</p>
          ) : didNotWinThisRound ? (
            <p className="text-sm text-[#6b6470]">
              You didn&rsquo;t win this round&rsquo;s draw — your bond and future contributions are safe, and you stay in for the next round.
            </p>
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
          <div className="mt-4 text-sm text-[#9a4a3a] bg-[#f3e3e0] border border-[#e8cfc9] rounded-2xl px-3 py-2.5">
            {txError}
          </div>
        )}
          </div>
        </div>

        {/* Right rail */}
        <div className="space-y-6">
          {/* Members */}
          <div className="rounded-2xl bg-white shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <Eyebrow muted>Members</Eyebrow>
              <span className="font-mono text-xs text-[#6b6470]">{members.length} / {seats}</span>
            </div>
            {members.length === 0 ? (
              <p className="text-sm text-[#6b6470]">No members yet.</p>
            ) : (
              <ul className="space-y-2">
                {members.map((m, i) => {
                  const isYou = m.toLowerCase() === userAddress?.toLowerCase();
                  return (
                    <li key={i} className="flex items-center justify-between text-sm rounded-xl px-3 py-2.5 bg-[#f6f4ee]">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Avatar seed={m} avatarUrl={profiles[m.toLowerCase()]?.avatarUrl} size={28} />
                        <span className="text-[#0b0b0e] truncate">{memberLabel(profiles[m.toLowerCase()], m)}</span>
                      </div>
                      <div className="flex gap-2 items-center shrink-0">
                        {isYou && <span className="font-mono text-[10px] tracking-[0.12em] uppercase bg-[#f0ead8] text-[#8a6d2f] px-2 py-1 rounded-full">You</span>}
                        {stateName === 'COMMIT' && isYou && (
                          <span className={`font-mono text-[10px] tracking-[0.12em] uppercase px-2 py-1 rounded-full ${hasCommitted ? 'bg-[#e6efe8] text-[#3a6d4a]' : 'bg-[#efece5] text-[#6b6470]'}`}>
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

          {/* Event feed */}
          {(events.length > 0 || pendingEvents.length > 0) && (
            <div className="rounded-2xl bg-white shadow-sm p-6">
              <Eyebrow muted>Recent activity</Eyebrow>
              <ul className="space-y-2 mt-4">
                {/* Optimistic entries for the user's own just-confirmed actions,
                    shown instantly while the indexer catches up (up to ~20s). */}
                {pendingEvents.map(ev => (
                  <li key={ev.txHash} className="text-xs text-[#6b6470] font-mono flex gap-3 items-center">
                    <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-[#c9a15c] border-t-transparent animate-spin" />
                    <span>{ev.name}</span>
                    <span className="text-[10px] uppercase tracking-wider text-[#c9a15c]/70">syncing…</span>
                    {ev.txHash && (
                      <a href={txUrl(ev.txHash)} target="_blank" rel="noopener noreferrer" className="text-[#6b6470] hover:text-[#c9a15c] transition-colors" title="View transaction on explorer">↗</a>
                    )}
                  </li>
                ))}
                {events.map((ev, i) => (
                  <li key={ev.txHash || i} className="text-xs text-[#6b6470] font-mono flex gap-3 items-center">
                    <span className="text-[#c9a15c]">[{ev.blockNumber.toString()}]</span>
                    <span>{ev.name}</span>
                    {ev.txHash && (
                      <a
                        href={txUrl(ev.txHash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#6b6470] hover:text-[#c9a15c] transition-colors"
                        title="View transaction on explorer"
                      >
                        ↗
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
    </AuthGate>
  );
}
