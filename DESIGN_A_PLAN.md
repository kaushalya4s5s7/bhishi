# Design A + Persistent Bid History — Full Implementation Spec

> **Audience:** an implementing model/engineer who will execute this literally.
> Do exactly what each numbered step says. Do not improvise beyond it. All file
> paths are repo-relative to the monorepo root. Line numbers reflect the state
> at spec-writing time — if they've drifted, match on the quoted code instead.

---

## 0. Background — the bug being fixed

`Circle.sol` runs an AUCTION (sealed-bid commit-reveal) ROSCA. When a round
advances, a past winner (`hasWon[m] == true`) is auto-marked `committed=true` /
`revealed=true` **without paying their contribution** (`commit()` never runs for
them, so `roundPool += contribution` is skipped). But winners still RECEIVE a
dividend each round. Net effect: each round with N past winners collects only
`contribution × (seats − N)`, so the pot and the 40%-of-pot bid cap shrink every
round. This caused a real `reveal(10 mUSDC)` to revert `BidExceedsCap`
(`0xe8920896`) in round 2 of a 3×10 circle (real cap was 8, UI showed 12), and
it breaks ROSCA fairness (last winner gets a fraction of the first winner's pot).

**Fix (Design A):** every member pays `contribution` EVERY round via `commit()`,
including past winners — but past winners can't bid or win. Winners pay by
committing; they do NOT need to reveal (committing is enough). The pot is thus
always `contribution × seats`.

**Also (bundled):** add a persistent per-round bid-history table. The bid amount
is currently in no event and `bidDiscount[]` is wiped each round, so this needs
the `Revealed` event to carry the bid + indexer/API/UI work. Only shows bids for
rounds that have ENDED (winner drawn) → no sealed-bid leak.

---

## PART 1 — CONTRACT (`packages/contracts/src/Circle.sol`)

### 1.1 Change the `Revealed` event to carry the bid

**Find** (≈ line 134):
```solidity
    event Revealed(address indexed member, uint256 indexed round);
```
**Replace with:**
```solidity
    event Revealed(address indexed member, uint256 indexed round, uint256 bid);
```

### 1.2 `commit()` — winners pay AND are auto-marked revealed

**Find** the body of `commit(bytes32 commitment)` (≈ lines 250–264), specifically
the block after the guards:
```solidity
        // CEI: record state before external call
        committed[msg.sender]   = true;
        commitmentOf[msg.sender] = commitment;
        roundPool               += contribution;

        emit Committed(msg.sender, currentRound);

        // Pull contribution
        IERC20(stable).safeTransferFrom(msg.sender, address(this), contribution);
```
**Replace with:**
```solidity
        // CEI: record state before external call
        committed[msg.sender]   = true;
        commitmentOf[msg.sender] = commitment;
        roundPool               += contribution;

        // AUCTION past winners ("prized subscribers") keep PAYING every round
        // but can never bid or win again. They pay by committing here; they do
        // NOT reveal. Auto-mark them revealed with a zero bid so the
        // all-revealed gate isn't blocked waiting on a reveal they'll never send
        // and they can't be slashed for a missing reveal. Their `commitment`
        // value is irrelevant (never checked, since they skip reveal()).
        if (mode == Mode.AUCTION && hasWon[msg.sender]) {
            revealed[msg.sender]    = true;
            bidDiscount[msg.sender] = 0;
            revealCount++;
            emit Revealed(msg.sender, currentRound, 0);
        }

        emit Committed(msg.sender, currentRound);

        // Pull contribution
        IERC20(stable).safeTransferFrom(msg.sender, address(this), contribution);
```
Rationale: past winners now contribute to `roundPool`, so the pot is full again.
The auto-reveal moved here (from round-advance) so it only happens once they've
actually PAID.

### 1.3 `reveal()` — emit the bid; block past winners

**Find** in `reveal(uint256 amount, bytes32 salt)` (≈ lines 286–314). Two edits:

(a) Add a guard right after the existing guards (after the
`if (revealed[msg.sender]) revert AlreadyRevealed();` line ≈ 290). A past winner
is already auto-revealed in `commit()`, so they'd hit `AlreadyRevealed` anyway —
but add an explicit, clearer guard for safety and intent:
```solidity
        // Past winners are auto-revealed at commit() and cannot bid; they must
        // never reach the bidding path. (Defensive: they're already revealed,
        // so the guard above also catches them.)
        if (mode == Mode.AUCTION && hasWon[msg.sender]) revert AlreadyRevealed();
```

(b) **Find** the emit near the end:
```solidity
        emit Revealed(msg.sender, currentRound);
```
**Replace with:**
```solidity
        emit Revealed(msg.sender, currentRound, mode == Mode.AUCTION ? amount : 0);
```
(For LUCKY_DRAW `amount == contribution`; report bid 0 there since there is no
discount bidding.)

### 1.4 Round advance — stop auto-committing winners

**Find** the round-advance loop in `entropyCallback` (≈ lines 617–632):
```solidity
            for (uint256 i = 0; i < n; i++) {
                address m = members[i];
                if (mode == Mode.AUCTION && hasWon[m]) {
                    // Past winners ("prized subscribers") are permanently excluded
                    // from bidding — auto-advance them so the all-committed/
                    // all-revealed checks aren't blocked waiting on them.
                    committed[m]   = true;
                    revealed[m]    = true;
                    bidDiscount[m] = 0;
                    revealCount++;
                } else {
                    committed[m]   = false;
                    revealed[m]    = false;
                    bidDiscount[m] = 0; // clear any stale bid from a prior round
                }
            }
```
**Replace with:**
```solidity
            // Reset EVERY member for the new round — past winners included.
            // They must actively commit (pay) again; the auto-reveal for winners
            // now happens in commit(), only after they've paid this round.
            for (uint256 i = 0; i < n; i++) {
                address m = members[i];
                committed[m]   = false;
                revealed[m]    = false;
                bidDiscount[m] = 0;
            }
```

### 1.5 Do NOT change

- `advanceToReveal()` — still requires all `joined` members committed. Winners
  are now among them (correct: the gate now waits for winners to pay).
- `_checkAllRevealed()` / `_activeCount()` / `_countCompliant()` — unchanged.
  Winners increment `revealCount` in commit() now, so the DRAW transition still
  fires exactly when all active members are revealed.
- `entropyCallback` winner selection (`eligible = joined && !hasWon`) — unchanged.
- `slash()` — unchanged; still keys on `committed`/`revealed`. A past winner who
  fails to pay (doesn't commit) is now slashable exactly like anyone else, which
  is the intended new behavior.
- `MAX_BID_DISCOUNT_BPS`, the `cap` check in reveal — unchanged. The cap is still
  `40% × roundPool`, but `roundPool` is now the full pool, so the cap is stable.

### 1.6 Rebuild ABI after contract edits

Run: `cd packages/contracts && forge build`. Then copy the regenerated ABI:
- Source: `packages/contracts/out/Circle.sol/Circle.json` (the `abi` field)
- Destinations that must be updated to the new ABI (they're consumed elsewhere):
  - `packages/shared/src/abis/Circle.json`
  - `packages/shared/dist/abis/Circle.json` (or rebuild the shared package:
    `cd packages/shared && npm run build`)
- Confirm the new `Revealed` entry has three inputs: `member`, `round`, `bid`.

---

## PART 2 — CONTRACT TESTS (`packages/contracts/test/`)

Follow TDD: write/adjust these FIRST, watch them fail, then confirm they pass
after the Part 1 edits. Run with `forge test`.

### 2.1 `test/Auction.t.sol` — rewrite the tests that encode the OLD bug

**`test_pastWinnerAutoAdvancedNextRound`** — currently asserts a winner is
auto-committed at round start. INVERT it. After round 0's draw and the round-1
COMMIT state, assert:
```solidity
        // Past winner must NOT be auto-committed anymore — they must pay again.
        assertFalse(circle.committed(r0Winner), "winner must commit (pay) each round");
        assertFalse(circle.revealed(r0Winner), "winner not revealed until they commit");
        // After the winner commits (pays), they ARE auto-revealed with bid 0.
        deal(address(stable), r0Winner, CONTRIB);
        vm.prank(r0Winner); stable.approve(address(circle), type(uint256).max);
        vm.prank(r0Winner); circle.commit(keccak256(abi.encodePacked(uint256(0), bytes32("x"), r0Winner)));
        assertTrue(circle.committed(r0Winner), "winner committed after paying");
        assertTrue(circle.revealed(r0Winner), "winner auto-revealed on commit");
        assertEq(circle.bidDiscount(r0Winner), 0, "winner bid forced to 0");
```
(Rename the test to `test_pastWinnerMustPayButAutoRevealsOnCommit`.)

**`test_fullAuctionCycleConservesBalance`** — remove the
`if (circle.hasWon(who)) continue;` skips in BOTH the commit loop and the reveal
loop, replaced by: winners commit (pay) but skip reveal. Concretely, in the
commit loop keep committing for everyone; in the reveal loop, `continue` only
for `hasWon` members (they're already auto-revealed). Add an assertion that the
pot is full each round:
```solidity
        // Pot must be the FULL pool every round now (winners keep paying).
        assertEq(circle.undrawnPools(), CONTRIB * SEATS, "pot must stay full each round");
```
(Place this assertion right after `advanceToReveal()` and before requestDraw, so
`roundPool` still holds the collected pot. Note: after the winner is credited,
`roundPool` is zeroed — so assert BEFORE the draw.)

**`test_soleRemainingBidderWinsFinalRound`** — the loop skips winners' commits.
Update so winners commit (pay) each earlier round but skip reveal. Keep the final
assertions (sole non-winner wins, state COMPLETED).

**`_fundAndJoin`** already deals `BOND + CONTRIB * 10`, enough for winners to keep
paying across rounds — no change needed there.

### 2.2 `test/Auction.t.sol` — ADD new regression tests

**`test_potIsFullEveryRoundWithPastWinners`** — 3×100e6 circle. Run round 0 to a
win. In round 1, have all 3 (including the winner) commit; assert
`circle.undrawnPools() == 300e6` after `advanceToReveal()`. This is the direct
regression test for the shrinking-pot bug.

**`test_round2BidUpTo40PctOfFullPoolAccepted`** — the real-world failing case.
3×10e6 circle (so full pool = 30e6, cap = 12e6). Round 0 → a win. Round 1: all
commit (winner pays); a non-winner reveals a bid of `10e6` (was reverting
before). Assert it does NOT revert and `bidDiscount == 10e6`. Also assert a bid
of `12e6` (exactly cap) passes and `12e6 + 1` reverts `BidExceedsCap`.

**`test_winnerWhoDoesNotPayIsSlashable`** — round 1, winner does NOT commit; other
members do and reveal. Warp past `roundStart + REVEAL_WINDOW`; call
`circle.slash(winner)`; assert winner `joined == false` and their bond was
consumed/redistributed (mirror the existing slash test assertions in
`test/Slashing.t.sol` / `test/SlashFSM.t.sol`).

### 2.3 Other test files to re-run and fix if red

- `test/ConservationInv.t.sol` — the balance-conservation invariant. Winners now
  paying may change intermediate balances; the invariant equation itself
  (`circleBalance == claimable + dust + undrawnPools + bonds`) should still hold.
  Fix any hard-coded expected numbers, not the invariant.
- `test/Fairness.t.sol` — if it asserts anything about pot size per round, update
  to the full-pot expectation.
- `test/CommitReveal.t.sol` — verify the `Revealed` event's new 3rd arg doesn't
  break any `vm.expectEmit`. Update expected emits to include the `bid` arg.
- Grep the whole test dir for `expectEmit` + `Revealed` and add the bid arg:
  `grep -rn "Revealed" packages/contracts/test`.

### 2.4 Green gate

`cd packages/contracts && forge test -vv` must be fully green before proceeding.

---

## PART 3 — DATABASE (`packages/db/prisma/schema.prisma`)

The existing `Round` model already has `winner` and `winningDiscount`. We need
per-member bids per round. Add a new model.

**Add** after the `Round` model:
```prisma
/// One member's revealed bid in one round of one circle. Append-only; populated
/// from the Revealed event (which now carries the bid). Enables the persistent
/// per-round bid-history table. Only ever holds already-revealed (public) bids.
model RoundBid {
  id            String   @id @default(cuid())
  circle        Circle   @relation(fields: [circleAddress], references: [address], onDelete: Cascade)
  circleAddress String
  roundNumber   Int
  member        String
  /// Revealed bid discount in token base units (0 for LUCKY_DRAW / past winners).
  bid           Decimal  @db.Decimal(78, 0)
  /// Set true once WinnerDrawn names this member as the round's winner.
  won           Boolean  @default(false)
  revealedAt    DateTime

  @@unique([circleAddress, roundNumber, member])
  @@index([circleAddress, roundNumber])
}
```

**Add** the back-relation to `Circle` model — find the relations block in `Circle`:
```prisma
  members Member[]
  rounds  Round[]
  events  ChainEvent[]
  invites Invite[]
```
**Replace with:**
```prisma
  members  Member[]
  rounds   Round[]
  roundBids RoundBid[]
  events   ChainEvent[]
  invites  Invite[]
```

**Migrate:** from the db package dir, run
`npx prisma migrate dev --name add_round_bid` (or the repo's migrate script).
Then regenerate the client: `npx prisma generate`.

---

## PART 4 — INDEXER (`apps/workers/src/indexer/sync.ts`)

The `Revealed` event now carries `bid`. Add a `case 'Revealed'` to the switch and
update `WinnerDrawn` to mark the winning bid row.

### 4.1 Add `Revealed` handler

**Find** the `default:` case (≈ lines 320–323):
```typescript
    default:
      // Committed/Revealed/Claimed/etc. are captured in ChainEvent; no derived
      // row to maintain for them today.
      logger.debug({ name }, 'event stored, no projection');
```
**Insert BEFORE it** a new case:
```typescript
    case 'Revealed': {
      const member = str(args.member);
      const round = Number(args.round ?? 0);
      const bid = String(args.bid ?? 0);
      if (!member) return;
      await prisma.roundBid.upsert({
        where: {
          circleAddress_roundNumber_member: {
            circleAddress, roundNumber: round, member,
          },
        },
        create: { circleAddress, roundNumber: round, member, bid, revealedAt: new Date() },
        update: { bid },
      });
      return;
    }
```
(Adjust `str(...)` usage to match the file's existing helper — confirm `str` and
`args` are already in scope in this function; they are used by sibling cases.)

### 4.2 Mark the winning bid in the `WinnerDrawn` handler

**Find** the `WinnerDrawn` case body (≈ lines 267–282). After the existing
`prisma.round.upsert(...)` and before the `notifyMember`/`return`, **add**:
```typescript
      if (winner) {
        // Flag the winner's bid row for this round so the history table can mark it.
        await prisma.roundBid.updateMany({
          where: { circleAddress, roundNumber: round, member: winner },
          data: { won: true },
        });
      }
```

### 4.3 Event-ABI note

The indexer decodes logs via the ABI. Ensure the indexer uses the UPDATED
`Circle.json` (Part 1.6) so the `Revealed` log decodes with the `bid` field.
Grep for where the ABI is imported in `apps/workers` and confirm it points at
`packages/shared` (rebuilt) — `grep -rn "Circle.json\|circleAbi\|abis/Circle" apps/workers/src`.

---

## PART 5 — API (`apps/api/src/circles/circles.service.ts` + controller)

Expose the per-round bid history in the circle detail response.

### 5.1 Include roundBids in `detail()`

**Find** in `detail()`:
```typescript
      include: {
        members: { orderBy: { joinedAt: 'asc' } },
        rounds: { orderBy: { roundNumber: 'asc' } },
      },
```
**Replace with:**
```typescript
      include: {
        members: { orderBy: { joinedAt: 'asc' } },
        rounds: { orderBy: { roundNumber: 'asc' } },
        roundBids: { orderBy: [{ roundNumber: 'asc' }, { revealedAt: 'asc' }] },
      },
```

**Find** the return:
```typescript
    return {
      ...serialize(circle),
      members: circle.members.map(serialize),
      rounds: circle.rounds.map(serialize),
    };
```
**Replace with:**
```typescript
    return {
      ...serialize(circle),
      members: circle.members.map(serialize),
      rounds: circle.rounds.map(serialize),
      roundBids: circle.roundBids.map(serialize),
    };
```
(No controller change needed — detail() is already exposed at
`GET /api/circles/:address`. Verify in `circles.controller.ts`.)

---

## PART 6 — WEB (`apps/web/src/`)

### 6.1 Extend the detail type (`lib/circle.ts`)

**Find** the `CircleDetail` interface and **add** a `roundBids` field + a row type.
After `CircleRoundRow`, add:
```typescript
/** One member's revealed bid in one completed round (from the indexer). */
export interface RoundBidRow {
  roundNumber: number;
  member: string;
  bid: string;        // base units (6 decimals)
  won: boolean;
  revealedAt: string;
}
```
And in `CircleDetail`, after `rounds: CircleRoundRow[];` add:
```typescript
  roundBids: RoundBidRow[];
```

### 6.2 Load roundBids in `CircleView.tsx` and render the history table

(a) Add state near the other detail state. NOTE: `CircleView` does NOT currently
store `detail.rounds`, so add BOTH:
```typescript
  const [roundBids, setRoundBids] = useState<RoundBidRow[]>([]);
  const [rounds, setRounds] = useState<CircleRoundRow[]>([]);
```
(import `RoundBidRow` and `CircleRoundRow` from `@/lib/circle`).

(b) In `loadFromApi`, after `setEvents(indexed)` (or wherever `detail` is
consumed), add:
```typescript
      setRoundBids(detail.roundBids ?? []);
      setRounds(detail.rounds ?? []);
```

(c) Add a derived, grouped structure before `return (`:
```typescript
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
```
(Uses the `rounds` state added in step (a).)

(d) Render, in the right rail (near the Members / Recent activity cards), gated on
`bidHistory.length > 0`:
```tsx
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
```
Note: round labels use `roundNumber + 1` for human display (rounds are
0-indexed on-chain), matching the existing header convention.

### 6.3 Bid cap fix — ALREADY DONE, verify only

`CircleView.tsx` already caps at `40% × (contribution × seats)` (full pool) and
the stale `roundPool` state/read was removed. This is correct ONLY with the
Design A contract (winners pay → roundPool = full pool). **Do not deploy the web
change against the OLD contract.** No further edit needed; just confirm it's
present.

---

## PART 7 — DEPLOY & CONFIG (coordinated, all-or-nothing)

1. `forge test` green (Part 2.4).
2. Deploy new `Circle` implementation + `CircleFactory` to Monad testnet using the
   repo's deploy script (`packages/contracts/script/Deploy.s.sol`). Record new
   addresses.
3. Update deployed addresses wherever configured (search:
   `grep -rn "0x" apps/web/src/lib/contracts.ts apps/api/src apps/workers/src | grep -i factory` and any `.env` / config with the factory address).
4. Run the Prisma migration (Part 3) on the indexer's DB.
5. Rebuild `packages/shared` so the new ABI propagates to web/api/workers.
6. Restart the indexer; it will index new circles with per-round bids. Old
   circles won't have bid history (event didn't emit bids before) — that's
   expected and acceptable.
7. Deploy web + api + workers together.

**Note:** the currently-stuck circle `0x3e1A…9a8F` on the OLD contract cannot be
fixed by this — its 10-bid is hash-locked and un-revealable; it resolves via
stall/slash. Do not attempt to migrate it.

---

## PART 8 — REAL-WORLD RESEARCH TODO (non-blocking, before mainnet)

Confirm bond sizing against real chit-fund/ROSCA practice: with winners paying
every round, a post-win defaulter still owes `contribution` for each remaining
round. Verify `BOND = (seats-1) × contribution` covers worst-case default
(a winner defaulting immediately after winning, owing seats-1 future
contributions — the bond exactly equals that, so it's the minimum viable; document
whether a safety margin is wanted). Reference: Indian Chit Funds Act 1982 +
2019 amendment (foreman commission, security requirements) and standard ROSCA
default-handling literature.

---

## Execution order (summary checklist)

1. [ ] Part 1 — edit `Circle.sol` (event, commit, reveal, round-advance).
2. [ ] Part 2 — write/adjust tests; `forge test` green.
3. [ ] Part 1.6 — rebuild + propagate ABI.
4. [ ] Part 3 — Prisma `RoundBid` model + migrate + generate.
5. [ ] Part 4 — indexer `Revealed` + `WinnerDrawn` handlers.
6. [ ] Part 5 — API `detail()` includes `roundBids`.
7. [ ] Part 6 — web type + `CircleView` history table; verify cap fix.
8. [ ] Part 7 — deploy contract, migrate DB, update addresses, ship all services.
9. [ ] Part 8 — bond research (before mainnet).
