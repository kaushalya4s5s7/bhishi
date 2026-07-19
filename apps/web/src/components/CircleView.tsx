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
import { fetchCircleDetail, type RoundBidRow, type CircleRoundRow } from '@/lib/circle';
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
  // The furthest-along (round, state) pair the LIVE chain read has confirmed.
  // loadFromApi() reads the indexer, which lags chain by up to ~20s, so its
  // response can carry a STALE earlier phase (e.g. still COMMIT after chain has
  // moved to REVEAL). Applying that would flicker the UI backward. We record
  // what loadLive() has seen and refuse to let the indexer path regress below
  // it for the same round. A genuinely NEW round (higher currentRound) always
  // wins — that only ever moves forward.
  const liveProgressRef = useRef<{ round: number; state: number }>({ round: -1, state: -1 });
  // The round in which THIS user was first observed (via chain hasWon) to have
  // won. Lets the "you won this round" callout fire live — the moment the draw
  // settles — without mistaking a PAST win (hasWon stays true forever) for a
  // fresh one. -1 = never observed winning yet.
  const [myWinRound, setMyWinRound] = useState<number>(-1);
  // Round for which we have CONFIRMED (via a live chain read) that THIS user
  // has committed. "committed" is monotonic within a round — once true it can
  // only be reset by the round actually advancing — but a raw per-poll read can
  // momentarily return zero: a lagging RPC node one block behind, or a
  // transient read failure. Recording the round here lets us treat "committed"
  // as sticky for that round so the UI never flickers commit-form ⇄ committed.
  const committedRoundRef = useRef<number>(-1);

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
  // Authoritative "has THIS user committed in the current round" — read from
  // the contract's `committed(address)` boolean, which IS reset to false each
  // round for non-winners. This is what drives hasCommitted.
  const [committedFlag, setCommittedFlag] = useState(false);
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
  const [computedHash, setComputedHash] = useState<string | null>(null);
  const [events, setEvents] = useState<{ name: string; args: Record<string, any>; blockNumber: bigint; txHash: string }[]>([]);
  // Optimistic feed entries for the user's OWN just-confirmed actions. The
  // indexed /events feed lags by up to ~20s (indexer polls the chain every
  // ~10s, then the UI polls the API every ~10s), so without this the user
  // wouldn't see their own commit/reveal/claim in "Recent activity" for a
  // while. Each entry drops itself once the indexed feed contains its txHash.
  const [pendingEvents, setPendingEvents] = useState<{ name: string; txHash: string; member?: string }[]>([]);
  const [roundBids, setRoundBids] = useState<RoundBidRow[]>([]);
  const [rounds, setRounds] = useState<CircleRoundRow[]>([]);

  // A pending entry is one of the USER'S OWN just-confirmed actions, so its
  // actor is always this wallet. We record it (as `member`) alongside the name
  // so the optimistic row reads identically to the indexed one — "You
  // committed" etc. — with no "syncing" placeholder: we already have the tx
  // hash (addPendingEvent bails without one), which is the only thing the
  // indexer would add, so there is nothing to wait for.
  function addPendingEvent(name: string, txHash: string) {
    if (!txHash) return;
    setPendingEvents(prev =>
      prev.some(p => p.txHash.toLowerCase() === txHash.toLowerCase())
        ? prev
        : [{ name, txHash, member: userAddress }, ...prev],
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
      const apiState = stateIdx === -1 ? 0 : stateIdx;
      const apiRound = detail.currentRound;
      // Never let the lagging indexer regress phase/round below what the live
      // chain read has already confirmed for this round (see liveProgressRef).
      // A newer round from the API is always accepted (only moves forward).
      const live = liveProgressRef.current;
      const apiIsStale =
        apiRound < live.round || (apiRound === live.round && apiState < live.state);
      if (!apiIsStale) {
        setState(apiState);
        setRound(apiRound);
      }
      setMode(detail.mode);
      setSeats(detail.seats);
      setContribution(BigInt(detail.contribution));
      setBond(BigInt(detail.bond));
      setMembers(memberList);
      const indexed = (eventsRes.events as { eventName: string; payload: Record<string, unknown>; blockNumber: string; txHash: string }[]).map(e => ({
        name: e.eventName ?? 'Event',
        args: e.payload ?? {},
        blockNumber: BigInt(e.blockNumber ?? '0'),
        txHash: e.txHash ?? '',
      }));
      setEvents(indexed);
      setRoundBids(detail.roundBids ?? []);
      setRounds(detail.rounds ?? []);
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
      const [stateVal, memberCountVal, roundVal, bondVal, seatsVal, contributionVal, modeVal] = await Promise.all([
        publicClient.readContract({ address: circleAddress, abi: circleAbi as any, functionName: 'state' }),
        publicClient.readContract({ address: circleAddress, abi: circleAbi as any, functionName: 'memberCount' }),
        publicClient.readContract({ address: circleAddress, abi: circleAbi as any, functionName: 'currentRound' }).catch(() => 0),
        // bond/seats/contribution/mode are immutable circle config, but everything
        // the user ACTS on depends on them (join approves `bond`; the UI shows
        // seats and per-round contribution; MODE decides whether the bid input is
        // shown at all). If the indexer hasn't caught this circle yet,
        // loadFromApi() 404s (or serves a placeholder row with zeros), so these
        // must come from the chain — otherwise join() fires with bond=0, skips
        // the approve, and reverts InsufficientAllowance; the page renders
        // "2 / 0 seats" nonsense; and — the bug this `mode` read fixes — a fresh
        // AUCTION circle falls back to the LUCKY_DRAW default, hiding the bid
        // field so a member can only enter a secret, never a bid.
        publicClient.readContract({ address: circleAddress, abi: circleAbi as any, functionName: 'bond' }).catch(() => null),
        publicClient.readContract({ address: circleAddress, abi: circleAbi as any, functionName: 'seats' }).catch(() => null),
        publicClient.readContract({ address: circleAddress, abi: circleAbi as any, functionName: 'contribution' }).catch(() => null),
        publicClient.readContract({ address: circleAddress, abi: circleAbi as any, functionName: 'mode' }).catch(() => null),
      ]);
      if (bondVal !== null) setBond(BigInt(bondVal as any));
      if (seatsVal !== null) setSeats(Number(seatsVal as any));
      if (contributionVal !== null) setContribution(BigInt(contributionVal as any));
      // Circle.sol Mode enum: 0 = LUCKY_DRAW, 1 = AUCTION.
      if (modeVal !== null) setMode(Number(modeVal) === 1 ? 'AUCTION' : 'LUCKY_DRAW');

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
        // Only burn the "already checked" key when the check is CONCLUSIVE
        // (everyone committed). If not everyone has committed yet — or a read
        // failed — leave the key unset so a LATER poll (after the final commit
        // lands) still fires advanceToReveal(). The previous unconditional set
        // stranded the circle in COMMIT whenever the first poll ran before the
        // last member had committed.
        void tryAdvanceToReveal(memberList).then(conclusive => {
          if (conclusive) advanceCheckedRef.current = advanceCheckKey;
        });
      }
      if (userAddress && Number(stateVal) === STATE_NAMES.indexOf('DRAW') && drawRequestedCheckedRef.current !== Number(roundVal)) {
        drawRequestedCheckedRef.current = Number(roundVal);
        void tryRequestDraw();
      }

      // Live winner detection: hasWon[] is the chain's own record of who has
      // taken a pot, updated INSIDE the draw tx — so it's true the instant the
      // draw settles, ~10-20s before the indexed WinnerDrawn event the banner
      // otherwise waits on. Reading it here lets the winner (and everyone's
      // member labels) reflect the result immediately. Merged into wonMembers.
      try {
        const wonFlags = await Promise.all(
          memberList.map(m =>
            publicClient.readContract({ address: circleAddress, abi: circleAbi as any, functionName: 'hasWon', args: [m] }).catch(() => false),
          ),
        );
        const liveWon = new Set(
          memberList.filter((_, i) => Boolean(wonFlags[i])).map(m => m.toLowerCase()),
        );
        // Union with the API-derived set: never drop a winner the indexer knew
        // about, never wait for the indexer to learn one chain already shows.
        setWonMembers(prev => {
          const merged = new Set(prev);
          liveWon.forEach(a => merged.add(a));
          return merged;
        });
        // First time we observe THIS user as a winner, stamp the round it
        // happened in, so the "you won this round" callout can distinguish a
        // fresh win from the permanent hasWon flag on later rounds.
        if (userAddress && liveWon.has(userAddress.toLowerCase())) {
          setMyWinRound(prev => (prev === -1 ? Number(roundVal) : prev));
        }
      } catch { /* transient RPC — keep prior wonMembers */ }

      // Whether THIS user has committed in the current round (authoritative
      // `committed` boolean). Sticky-within-round below to defeat flicker.
      let nextCommitted = false;
      // True when the committed read was inconclusive (failed, or a genuine
      // false after we've already confirmed a commit this round via a lagging
      // node) — hold the prior value instead of regressing to "not committed".
      let nextCommittedResolvedLater = false;
      let nextClaimable = 0n;
      let nextBalance = 0n;
      let nextRevealed = false;
      const liveRoundNum = Number(roundVal);
      if (userAddress) {
        const READ_FAILED = '__failed__';
        const [committedRaw, info, bal, hasRevealed] = await Promise.all([
          // committed: THE authoritative "committed this round" flag — reset to
          // false each round for non-winners by the contract. (commitmentOf is
          // NOT read: the contract never clears it on round advance, so it
          // would hold a stale prior-round hash and wrongly read as committed.)
          publicClient.readContract({ address: circleAddress, abi: circleAbi as any, functionName: 'committed', args: [userAddress] }).catch(() => READ_FAILED),
          // memberInfo returns (joined, stakedBond, contribution, claimable)
          publicClient.readContract({ address: circleAddress, abi: circleAbi as any, functionName: 'memberInfo', args: [userAddress] }).catch(() => [false, 0n, 0n, 0n]),
          stableBalance(userAddress).catch(() => 0n),
          publicClient.readContract({ address: circleAddress, abi: circleAbi as any, functionName: 'revealed', args: [userAddress] }).catch(() => false),
        ]);
        // If the round moved on, the previous round's "committed" no longer
        // applies — clear the sticky marker so the fresh round starts clean.
        if (committedRoundRef.current !== -1 && committedRoundRef.current !== liveRoundNum) {
          committedRoundRef.current = -1;
        }
        if (committedRaw !== READ_FAILED) {
          nextCommitted = Boolean(committedRaw);
          // First confirmed commit for this round → mark it sticky.
          if (nextCommitted) committedRoundRef.current = liveRoundNum;
        }
        // Inconclusive if the read failed, OR came back false while we've
        // already confirmed a commit for this round (lagging RPC node). Resolve
        // against the TRUE prior value in the functional setter below.
        const committedReadFailed = committedRaw === READ_FAILED;
        const staleFalse = !nextCommitted && committedRoundRef.current === liveRoundNum;
        nextCommittedResolvedLater = committedReadFailed || staleFalse;
        nextClaimable = BigInt((info as any)[3] ?? 0n);
        nextBalance = bal;
        nextRevealed = Boolean(hasRevealed);
      }

      // Record the furthest-along phase chain has confirmed, so the lagging
      // indexer path (loadFromApi) can't later regress the UI below it.
      const liveRound = Number(roundVal);
      const liveState = Number(stateVal);
      const prev = liveProgressRef.current;
      if (liveRound > prev.round || (liveRound === prev.round && liveState > prev.state)) {
        liveProgressRef.current = { round: liveRound, state: liveState };
      }

      // Commit together so the render never mixes a fresh field with a stale one.
      setState(Number(stateVal));
      setRound(Number(roundVal));
      setMembers(memberList);
      // Functional updater so the sticky decision resolves against the ACTUAL
      // current value (loadLive's deps don't include committedFlag, so its
      // closure copy can be stale). Inconclusive poll → keep prior; otherwise
      // take the fresh read.
      setCommittedFlag(prev => (nextCommittedResolvedLater ? prev : nextCommitted));
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
  /**
   * @returns `true` when the outcome for this round is CONCLUSIVE — either we
   *   advanced it, or everyone had committed (someone else may have advanced).
   *   `false` means "not everyone has committed yet", so the caller MUST keep
   *   re-checking on future polls rather than marking this round done. A thrown
   *   read/write is treated as inconclusive (`false`) too, so a transient RPC
   *   failure never permanently disables the advance for this round.
   */
  async function tryAdvanceToReveal(memberList: string[] = members): Promise<boolean> {
    try {
      const committedFlags = await Promise.all(
        memberList.map(m =>
          publicClient.readContract({ address: circleAddress, abi: circleAbi as any, functionName: 'committed', args: [m] }),
        ),
      );
      const allCommitted = committedFlags.every(Boolean);
      if (!allCommitted) return false;
      await write({ address: circleAddress, abi: circleAbi as any, functionName: 'advanceToReveal', args: [] });
      return true;
    } catch {
      // Someone else likely already advanced it, or the circle isn't ready —
      // either way, not an error worth surfacing to this user. Treated as
      // inconclusive so a NotCommitPhase revert (already advanced) is fine, but
      // a transient RPC error still leaves the round eligible for a retry.
      return false;
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

  /** Single entry point for the Commit button: derives the hash from the
   *  current bid/secret inline rather than requiring a separate "compute"
   *  step, so the UI is one field + one button instead of a field, a
   *  compute link, a hash callout, and a button all stacked at once. */
  function doCommit() {
    const hash = computedHash ?? computeHash();
    if (!hash) return;
    doWriteWithApproval('commit', [hash], contribution);
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
  function computeHash(): `0x${string}` | null {
    if (!userAddress || !secret) return null;
    if (mode === 'AUCTION' && !bidValid) {
      setTxError(`Enter a bid between 0 and ${maxBidMusdc.toFixed(2)} mUSDC (max 40% of the pot).`);
      return null;
    }
    try {
      const amount = mode === 'AUCTION' ? bidUnits : contribution;
      const hash = computeCommitment(amount, secret, userAddress);
      setComputedHash(hash);
      return hash;
    } catch {
      setTxError('Invalid secret — must be a whole number');
      return null;
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
  // Live winner recognition for THIS user: chain's hasWon[] (read in loadLive,
  // merged into wonMembers) flips the instant the draw settles, ~10-20s before
  // the WinnerDrawn event arrives. So the winner sees "that's you" immediately,
  // not after the indexer catches up. The event still supplies the tx link and
  // the round label when it lands.
  const iHaveWonLive = Boolean(userAddress && wonMembers.has(userAddress.toLowerCase()));
  const iAmLastWinner =
    (Boolean(lastWinnerAddress) && userAddress && lastWinnerAddress!.toLowerCase() === userAddress.toLowerCase()) ||
    iHaveWonLive;
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
  // Authoritative: the contract's `committed` boolean (reset each round),
  // NOT commitmentOf (which persists stale across rounds).
  const hasCommitted = committedFlag;
  const pot = (Number(contribution) / 1e6) * seats;
  const isAuction = mode === 'AUCTION';

  // Round progress. A full cycle is `seats` rounds — every member wins exactly
  // once. `round` (currentRound) is 0-indexed: the round in progress is
  // round+1, and rounds completed so far equals `round` (or all `seats` once
  // the circle is COMPLETED). Only meaningful once the cycle has started.
  const cycleStarted = stateName !== 'FILLING' && stateName !== 'ABORTED_FILLING';
  const roundsDone = stateName === 'COMPLETED' ? seats : Math.min(round, seats);
  const activeRoundNo = Math.min(round + 1, seats); // 1-indexed round in progress

  // AUCTION bid derivations. The bid (discount) is capped at 40% of this
  // round's pool (Circle.sol MAX_BID_DISCOUNT_BPS). The on-chain `roundPool`
  // The contract enforces the bid cap at REVEAL as 40% × roundPool, where
  // roundPool is the total contributions collected that round. Every member
  // (including past winners, who pay but don't bid) contributes once per round,
  // so the round always converges to contribution × seats. We cap against that
  // FINAL pool — NOT max(live roundPool, fullPool). The old max() could inflate
  // the cap using a transient/larger roundPool (or, in a round where a past
  // winner hadn't paid, overstate it), letting a member commit a bid the
  // contract then rejects with BidExceedsCap at reveal — an un-revealable,
  // slashable bid. Capping strictly on the final full pool never overstates.
  // Cap = 40% of the FINAL round pool. With the Design-A contract fix, every
  // member (past winners included — they pay but don't bid) contributes once
  // per round, so roundPool always converges to contribution × seats by reveal
  // time. Capping on that full pool matches the contract's reveal-time check
  // exactly and never overstates, while keeping the cap stable as members
  // commit (unlike capping on the still-growing live roundPool, which would
  // reject valid bids typed before everyone has committed).
  const fullPoolUnits = contribution * BigInt(seats);
  const maxBidUnits = (fullPoolUnits * 4000n) / 10000n; // 40% of the full pool
  const maxBidMusdc = Number(maxBidUnits) / 1e6;
  const bidNum = bid.trim() === '' ? NaN : Number(bid);
  const bidUnits = Number.isFinite(bidNum) ? BigInt(Math.round(bidNum * 1e6)) : 0n;
  const bidValid = Number.isFinite(bidNum) && bidNum >= 0 && bidUnits <= maxBidUnits;

  const phaseForBadge = (() => {
    if (stateName === 'ABORTED_FILLING') return 'ABORTED';
    if (stateName === 'PAYOUT') return 'COMPLETED';
    return stateName;
  })();

  // Turn a raw event (indexed OR the user's own pending copy) into a plain,
  // human-readable "who did what" line. The actor's address comes from the
  // event arg that carries it (member/winner/defaulter); we label it with the
  // member's profile name, or "You" when it's this wallet. Returns null for
  // events with no meaningful actor line (they just aren't shown).
  function describeActivity(name: string, args: Record<string, any>): { actor: string; text: string } | null {
    const actorAddr =
      (typeof args.member === 'string' && args.member) ||
      (typeof args.winner === 'string' && args.winner) ||
      (typeof args.defaulter === 'string' && args.defaulter) ||
      undefined;
    const who = actorAddr
      ? (userAddress && actorAddr.toLowerCase() === userAddress.toLowerCase()
          ? 'You'
          : memberLabel(profiles[actorAddr.toLowerCase()], actorAddr))
      : null;
    const roundNo = args.round !== undefined && args.round !== null ? Number(args.round) : undefined;
    const roundSuffix = roundNo !== undefined ? ` round ${roundNo}` : '';

    switch (name) {
      case 'Joined':
        return who ? { actor: who, text: `${who} joined the circle` } : null;
      case 'Committed':
        return who ? { actor: who, text: `${who} committed${roundSuffix}` } : null;
      case 'Revealed':
        return who ? { actor: who, text: `${who} revealed their bid${roundSuffix}` } : null;
      case 'WinnerDrawn':
        return who ? { actor: who, text: `${who} won${roundSuffix} 🎉` } : null;
      case 'Claimed':
        return who ? { actor: who, text: `${who} claimed their balance` } : null;
      case 'Slashed':
        return who ? { actor: who, text: `${who} was slashed for missing the reveal` } : null;
      case 'RoundStarted':
        return { actor: '', text: `Round ${roundNo ?? ''} started`.trim() };
      case 'DrawRequested':
        return { actor: '', text: `Draw requested${roundSuffix}` };
      case 'Stalled':
        return { actor: '', text: `Circle stalled${roundSuffix}` };
      case 'FillingRefunded':
        return { actor: '', text: `Circle refunded during filling` };
      default:
        return { actor: '', text: name };
    }
  }

  // Group revealed bids by round for the persistent history table. Only rounds
  // that have a winner (ended) are shown — never live/sealed bids. Ascending.
  const bidHistory = (() => {
    const byRound = new Map<number, RoundBidRow[]>();
    for (const b of roundBids) {
      const arr = byRound.get(b.roundNumber) ?? [];
      arr.push(b);
      byRound.set(b.roundNumber, arr);
    }
    // A round is "ended" if the indexer recorded a winner for it (rounds[] has
    // winner set) OR any bid row for it is marked won.
    const endedRounds = new Set(
      rounds.filter(r => r.winner).map(r => r.roundNumber),
    );
    return [...byRound.entries()]
      .filter(([rn, bids]) => endedRounds.has(rn) || bids.some(b => b.won))
      .sort((a, b) => a[0] - b[0])
      .map(([roundNumber, bids]) => ({ roundNumber, bids }));
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
      {/* Invite messaging is gated on the ON-CHAIN membership truth (isMember),
          not just the server's invite status. The server marks a link "full" /
          invalid once all seats are taken — correct for a STRANGER, but an
          EXISTING member opening that same link would otherwise be told the
          "circle is full / link no longer active," which is false for them.
          So: if you're a member, you ALWAYS get "you're already a member" and
          never see a full/invalid warning. The invalid/full and "you're
          invited" banners are shown only to NON-members. `isMember` is derived
          from the live member list, so this waits for real data (the skeleton
          gate above ensures state !== null before we render at all). */}
      {isMember ? (
        <div className="text-sm text-[#3a6d4a] bg-[#e6efe8] border border-[#cfe0d3] rounded-2xl px-4 py-3 mb-6">
          You’re already a member of this circle.
        </div>
      ) : (
        <>
          {inviteState && !inviteState.valid && (
            <div className="text-sm text-[#9a4a3a] bg-[#f3e3e0] border border-[#e8cfc9] rounded-2xl px-4 py-3 mb-6">
              {inviteState.reason === 'full'
                ? 'This circle is now full — the invite link is no longer active.'
                : 'This invite link is no longer valid, but you can still view the circle below.'}
            </div>
          )}
          {inviteState?.valid && (
            <div className="text-sm text-[#3a6d4a] bg-[#e6efe8] border border-[#cfe0d3] rounded-2xl px-4 py-3 mb-6">
              You’ve been invited to this circle. Join below to claim your seat.
            </div>
          )}
        </>
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
            {cycleStarted && (
              <span className="font-mono text-xs text-[#6b6470]">
                {stateName === 'COMPLETED'
                  ? `All ${seats} rounds complete`
                  : `Round ${activeRoundNo} of ${seats} · ${roundsDone}/${seats} done`}
              </span>
            )}
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
            <div className="mt-1.5 text-sm text-[#6b6470]">
              {/* Full cycle length = seats: every member wins exactly one round. */}
              Cycle length{' '}
              <span className="font-medium text-[#0b0b0e]">{seats} rounds</span>
              {' '}— one per member
              {cycleStarted && (
                <>
                  {' · '}
                  <span className="font-medium text-[#0b0b0e]">{roundsDone}/{seats} done</span>
                </>
              )}
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
          // Fresh "you won" callout right after this round's draw. Trust EITHER
          // the indexed event (lastWinnerRound === round) OR the live chain flag
          // (iHaveWonLive), so the winner sees confirmation the moment the draw
          // settles rather than after the indexer catches up. iHaveWonLive is
          // true for a past winner in later rounds too, but by then a NEW
          // WinnerDrawn event for someone else sets lastWinnerRound === round
          // with a different winner, so this only reads as "you won" while the
          // winner's own pot is the freshest result — which is exactly the
          // window we want the callout shown in.
          const wonThisRound =
            (iAmLastWinner && lastWinnerRound === round) ||
            (myWinRound !== -1 && myWinRound === round);
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
              onClick={async () => {
                // bond is read from the indexer and live chain (loadLive), but
                // a fast click can land before either resolves. Never
                // approve/join for an unverified 0 amount — fetch it from the
                // contract right here instead of bouncing the user.
                let joinBond = bond;
                if (joinBond === 0n) {
                  try {
                    joinBond = BigInt(
                      (await publicClient.readContract({
                        address: circleAddress, abi: circleAbi as any, functionName: 'bond',
                      })) as bigint,
                    );
                    setBond(joinBond);
                  } catch {
                    setTxError('Could not load the circle bond — check your connection and try again.');
                    return;
                  }
                }
                doWriteWithApproval('join', [], joinBond);
              }}
              disabled={txPending}
            >
              {txPending ? 'Joining…' : 'Join circle'}
            </Button>
          )
        ) : stateName === 'COMMIT' ? (
          isMember ? (
            iHaveWonLive ? (
              // Past winner ("prized subscriber") — the contract auto-advances
              // them each round so they never bid again. They still contribute
              // and share dividends, but take no commit/reveal action.
              <p className="text-sm text-[#6b6470]">
                You&rsquo;ve already won a round, so you sit out the bidding from here on — you stay in the circle, keep contributing, and share each round&rsquo;s dividend. Nothing to do this round.
              </p>
            ) : hasCommitted ? (
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
                <Button
                  onClick={doCommit}
                  disabled={txPending || !secret || (isAuction && !bidValid)}
                >
                  {txPending ? 'Committing…' : 'Commit'}
                </Button>
                {computedHash && (
                  <p className="font-mono text-[11px] text-[#6b6470] truncate" title={computedHash}>
                    Hash {computedHash.slice(0, 10)}…{computedHash.slice(-6)}
                  </p>
                )}
              </div>
            )
          ) : (
            <p className="text-sm text-[#6b6470]">You are not a member of this circle.</p>
          )
        ) : stateName === 'REVEAL' ? (
          isMember ? (
            iHaveWonLive ? (
              <p className="text-sm text-[#6b6470]">
                You&rsquo;ve already won a round, so you sit out the bidding — nothing to reveal. Waiting for the other members, then the draw runs.
              </p>
            ) : revealed ? (
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
                        {(() => {
                          // A past winner is auto-marked committed+revealed by the
                          // contract at each new round start (Circle.sol excludes
                          // "prized subscribers" from bidding). Showing them as
                          // "Committed" reads as an action they never took — label
                          // it "Won" so it's clear they're sitting the round out,
                          // not that the next round somehow started on their behalf.
                          const memberWon = wonMembers.has(m.toLowerCase());
                          if (memberWon) {
                            return (
                              <span className="font-mono text-[10px] tracking-[0.12em] uppercase bg-[#f0ead8] text-[#8a6d2f] px-2 py-1 rounded-full">
                                Won · sitting out
                              </span>
                            );
                          }
                          if (stateName === 'COMMIT' && isYou) {
                            return (
                              <span className={`font-mono text-[10px] tracking-[0.12em] uppercase px-2 py-1 rounded-full ${hasCommitted ? 'bg-[#e6efe8] text-[#3a6d4a]' : 'bg-[#efece5] text-[#6b6470]'}`}>
                                {hasCommitted ? 'Committed' : 'Pending'}
                              </span>
                            );
                          }
                          return null;
                        })()}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Round results — persistent per-round bid history */}
          {bidHistory.length > 0 && (
            <div className="rounded-2xl bg-white shadow-sm p-6">
              <Eyebrow muted>Round results</Eyebrow>
              <div className="mt-4 space-y-4">
                {bidHistory.map(({ roundNumber, bids }) => (
                  <div key={roundNumber}>
                    <div className="text-xs font-mono text-[#6b6470] mb-1.5">Round {roundNumber + 1}</div>
                    <ul className="space-y-1">
                      {bids.map(b => {
                        const isYou = userAddress && b.member.toLowerCase() === userAddress.toLowerCase();
                        const label = memberLabel(profiles[b.member.toLowerCase()], b.member);
                        const isPastWinnerZero = b.bid === '0' && !b.won;
                        return (
                          <li key={b.member} className="flex items-center justify-between text-sm">
                            <span className="truncate text-[#0b0b0e]">
                              {isYou ? 'You' : label}
                            </span>
                            <span className={b.won ? 'text-[#c9a15c] font-semibold' : 'text-[#6b6470]'}>
                              {isPastWinnerZero
                                ? 'paid · no bid'
                                : `${(Number(b.bid) / 1e6).toFixed(2)} mUSDC`}
                              {b.won && ' · WON'}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Event feed */}
          {(events.length > 0 || pendingEvents.length > 0) && (
            <div className="rounded-2xl bg-white shadow-sm p-6">
              <Eyebrow muted>Recent activity</Eyebrow>
              <ul className="space-y-2.5 mt-4">
                {/* The user's OWN just-confirmed actions render INSTANTLY as
                    finished rows — no "syncing" spinner. We already hold the tx
                    hash (the only thing the indexer would add), so there is
                    nothing to wait for. Each de-dupes itself once the indexed
                    copy arrives (loadFromApi drops it by txHash). */}
                {pendingEvents.map(ev => {
                  const d = describeActivity(ev.name, { member: ev.member });
                  return (
                    <li key={ev.txHash} className="text-sm text-[#3f3a46] flex gap-2 items-center justify-between">
                      <span className="min-w-0 truncate">{d?.text ?? ev.name}</span>
                      {ev.txHash && (
                        <a href={txUrl(ev.txHash)} target="_blank" rel="noopener noreferrer" className="text-[#6b6470] hover:text-[#c9a15c] transition-colors shrink-0" title="View transaction on explorer">↗</a>
                      )}
                    </li>
                  );
                })}
                {events.map((ev, i) => {
                  const d = describeActivity(ev.name, ev.args);
                  if (!d) return null;
                  return (
                    <li key={ev.txHash || i} className="text-sm text-[#3f3a46] flex gap-2 items-center justify-between">
                      <span className="min-w-0 truncate">{d.text}</span>
                      {ev.txHash && (
                        <a
                          href={txUrl(ev.txHash)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[#6b6470] hover:text-[#c9a15c] transition-colors shrink-0"
                          title="View transaction on explorer"
                        >
                          ↗
                        </a>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
    </AuthGate>
  );
}
