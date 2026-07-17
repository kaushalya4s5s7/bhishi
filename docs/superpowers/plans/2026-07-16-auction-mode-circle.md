# AUCTION Mode Implementation Plan

> **For Claude:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `Mode.AUCTION` in `Circle.sol` — a sealed-bid discount auction each round, faithfully replicating the real-world Indian "bidding chit fund" mechanism, as an alternative to the already-working `Mode.LUCKY_DRAW` VRF draw.

**Architecture:** Reuse the existing COMMIT→REVEAL→DRAW phases and commit-reveal machinery unchanged. In AUCTION mode, the value committed/revealed each round is a **bid discount** (uint256, in the same token decimals as `contribution`) instead of the contribution amount — the contribution itself is still paid in full at `commit()` regardless of mode, exactly as today. At the DRAW step, `fulfillRandomness`'s winner-selection logic branches on `mode`: LUCKY_DRAW keeps today's VRF-random selection unchanged; AUCTION instead picks the highest revealed bid among eligible (`!hasWon`) members, with VRF used only as the real-world "lottery" tie-breaker (when multiple members bid the same max, or when nobody bid at all — fallback to a full VRF draw at zero discount). The discount is distributed as a dividend to **every** joined member (winner included), matching real chit-fund practice, with no organizer/foreman commission cut (Bhishi is fee-free by design). A permanent-exclusion rule (`hasWon`) already exists and is reused unchanged — once a member wins, they're excluded from bidding/being drawn in all future rounds, matching real "prized subscriber" behavior.

**Tech Stack:** Solidity ^0.8.24, Foundry (forge/anvil), OpenZeppelin (already-used SafeERC20, ReentrancyGuard). No new dependencies.

---

## Key design decisions (context for every task below)

1. **Bid encoding reuses `commit`/`reveal`.** `commitmentOf`/`committed`/`revealed`/`revealCount` are unchanged. In LUCKY_DRAW, `reveal(amount, salt)` requires `amount == contribution` (unchanged). In AUCTION, `reveal(amount, salt)` is repurposed as `reveal(bidDiscount, salt)` — `bidDiscount` can be `0` (meaning "I will bid, but for zero discount" — distinct from not bidding at all) up to `MAX_BID_DISCOUNT_BPS` of `contribution * (currentRound-eligible pot size)`. See task 2 for the exact cap formula.
2. **Only non-winners may bid.** `hasWon[msg.sender] == true` members must still `commit`/`reveal` a **dummy zero bid** for accounting parity, OR — cleaner — are exempted from bidding entirely and their `committed`/`revealed` status is force-set on round advance. Chosen approach (see task 3): past winners are **auto-marked committed+revealed with bidDiscount=0** when a new round starts, so `advanceToReveal`'s "all active members committed" check and `_checkAllRevealed`'s all-revealed check keep working unmodified — this is the smallest change to the FSM.
3. **New storage:** `mapping(address => uint256) public bidDiscount` (populated on reveal, meaningful only in AUCTION mode). No separate "highest bid so far" tracker is maintained during reveals — the winner and any tie are recomputed by scanning `bidDiscount[]` once, at draw time inside `fulfillRandomness`, so there is exactly one place that decides who's winning (see Task 4).
4. **Cap:** `MAX_BID_DISCOUNT_BPS = 4000` (40%, matching real-world convention researched: architecture-spec §6 already anticipates this). Cap applies to `roundPool` (the pot being auctioned this round) — `bidDiscount <= roundPool * MAX_BID_DISCOUNT_BPS / 10000`. Enforced at `reveal()` time (revert if exceeded), not at `commit()` (commitment is a hash, can't be validated before reveal).
5. **Tie-break / no-bid fallback → VRF.** If the highest revealed bid is shared by 2+ eligible members, OR if zero eligible members revealed a positive-or-zero bid (edge case: everyone was slashed before reveal, already handled by existing `eligibleCount==0` STALLED path — unchanged), fall back to the exact same VRF random-selection path already in `fulfillRandomness` for LUCKY_DRAW, applied to the tied subset (or the full eligible set if no one bid). This reuses `requestDraw()`/`fulfillRandomness()`/`vrfOperator` unchanged — AUCTION mode still calls `fulfillRandomness` every round, just with different pre-selection logic before the VRF-random tie-break.
6. **Dividend distribution:** the winning bid's `bidDiscount` is split pro-rata (integer division, remainder → `dustAccrued`, exactly matching the existing slash/reclaim dust pattern) to **all currently-joined members**, credited to `claimable` — this happens in the same `fulfillRandomness` call, after the winner is selected, before advancing round/completing.
7. **Winner still pays full contribution** — already true today (`commit()` pulls `contribution` unconditionally, unchanged for both modes) — no code change needed for this, just confirming the existing behavior satisfies the real-world rule.

---

## File Structure

- Modify: `packages/contracts/src/Circle.sol` — core auction logic (all changes; no new file needed given the small surface area and the codebase's existing single-file convention for `Circle.sol`)
- Modify: `packages/contracts/src/CircleFactory.sol` — no functional change expected (already accepts `Mode`), but re-verify after Circle changes
- Create: `packages/contracts/test/Auction.t.sol` — new test file, mirrors existing per-feature test file convention (e.g. `Slashing.t.sol`, `ReclaimOnStall.t.sol`)
- Modify: `packages/contracts/test/SlashFSM.t.sol:68-72` — remove/replace `test_auctionModeRevertsOnCreate` since AUCTION will no longer revert on create
- Modify: `packages/contracts/test/ConservationInv.t.sol` — extend the invariant handler to also drive AUCTION-mode circles (critical: the conservation invariant must hold for auctions too, since dividends move money around in a new way)
- Modify: `packages/contracts/script/SeedDemo.s.sol:29` — no change required (stays LUCKY_DRAW for the demo script) — confirmed out of scope

---

## Task 1: Add auction storage + cap constant, remove the AUCTION revert guard

**Files:**
- Modify: `packages/contracts/src/Circle.sol:45` (remove `AuctionNotImplemented` error — no longer used)
- Modify: `packages/contracts/src/Circle.sol:70-74` (add constant)
- Modify: `packages/contracts/src/Circle.sol:101-106` (add storage)
- Modify: `packages/contracts/src/Circle.sol:143-144` (remove revert guard)
- Test: `packages/contracts/test/SlashFSM.t.sol`

- [ ] **Step 1: Write the failing test** — replace the old revert-on-create test with one proving AUCTION mode is now accepted at creation.

In `packages/contracts/test/SlashFSM.t.sol`, replace lines 68-72:

```solidity
    /// @notice AUCTION mode is now accepted at initialization (no longer a stub).
    function test_auctionModeAcceptedOnCreate() public {
        Circle circle = Circle(factory.createCircle(CONTRIB, SEATS, BOND, Mode.AUCTION));
        assertEq(uint256(circle.mode()), uint256(Mode.AUCTION));
        assertEq(uint256(circle.state()), uint256(Circle.State.FILLING));
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/contracts && forge test --match-test test_auctionModeAcceptedOnCreate -vv`
Expected: FAIL — reverts with `AuctionNotImplemented` (guard still present).

- [ ] **Step 3: Write minimal implementation**

In `packages/contracts/src/Circle.sol`:

1. Remove line 45: `error AuctionNotImplemented();`
2. Remove line 144: `if (_mode == Mode.AUCTION) revert AuctionNotImplemented();`
3. Add after line 74 (`uint256 public constant VRF_TIMEOUT = 1 days;`):
   ```solidity
   uint256 public constant MAX_BID_DISCOUNT_BPS = 4000; // 40% of round pool, matches real-world chit-fund convention
   ```
4. Add after line 106 (`uint256 public roundPool;`):
   ```solidity
   // ─── auction-mode bid tracking (reset each round) ──────────────────────────
   // Deliberately just the raw revealed bids — no incremental "highest so far"
   // tracker. The winner/tie set is recomputed by scanning bidDiscount[] at
   // draw time (fulfillRandomness, Task 4), so there is exactly one place that
   // decides who's winning, not two trackers that could drift out of sync.
   mapping(address => uint256) public bidDiscount; // revealed bid, meaningful only in AUCTION mode
   ```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/contracts && forge test --match-test test_auctionModeAcceptedOnCreate -vv`
Expected: PASS

Also run the full suite to confirm nothing else broke:
Run: `cd packages/contracts && forge test`
Expected: all previously-passing tests still pass (the removed error/guard has no other references — verify via `grep -rn "AuctionNotImplemented" packages/contracts` returning zero matches after this step).

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/Circle.sol packages/contracts/test/SlashFSM.t.sol
git commit -m "feat(contracts): accept AUCTION mode at circle creation"
```

---

## Task 2: Auto-mark past winners as committed+revealed at round start (AUCTION-only, no-op for LUCKY_DRAW)

**Why:** Past winners (`hasWon == true`) must not bid (real-world rule: "prized subscribers" are permanently excluded from bidding). Rather than adding new branches to `commit`/`reveal`/`advanceToReveal`/`_checkAllRevealed` to special-case "skip winners," the simplest correct fix is to pre-populate their commit/reveal status when each new round begins, so the existing "all active members must have committed/revealed" logic keeps working unmodified for both modes. This only matters starting round 2+ (a member can't have `hasWon==true` in round 0).

**Files:**
- Modify: `packages/contracts/src/Circle.sol` — the round-advance block inside `fulfillRandomness` (around line 464-477, the "else" branch that resets per-round state)
- Test: `packages/contracts/test/Auction.t.sol` (new file — create it now with this first test)

- [ ] **Step 1: Write the failing test**

Create `packages/contracts/test/Auction.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Circle, Mode} from "../src/Circle.sol";
import {CircleFactory} from "../src/CircleFactory.sol";
import {MockStable} from "../src/MockStable.sol";

/// @notice Auction (Mode.AUCTION) round mechanics — sealed-bid discount chit fund.
contract AuctionTest is Test {
    MockStable    internal stable;
    CircleFactory internal factory;

    uint256 internal constant CONTRIB = 100e6;
    uint256 internal constant SEATS   = 3;
    uint256 internal constant BOND    = (SEATS - 1) * CONTRIB;

    address internal alice = address(0xA11CE);
    address internal bob   = address(0xB0B);
    address internal carol = address(0xCA401);

    function setUp() public {
        stable  = new MockStable();
        address impl = address(new Circle());
        factory = new CircleFactory(impl, address(stable), address(0));
    }

    function _fundAndJoin(Circle circle, address who) internal {
        deal(address(stable), who, BOND + CONTRIB * 10);
        vm.prank(who); stable.approve(address(circle), type(uint256).max);
        vm.prank(who); circle.join();
    }

    /// @notice A member who has already won must be auto-marked committed+revealed
    ///         at the start of a later round (they are excluded from bidding).
    function test_pastWinnerAutoAdvancedNextRound() public {
        Circle circle = Circle(factory.createCircle(CONTRIB, SEATS, BOND, Mode.AUCTION));
        _fundAndJoin(circle, alice);
        _fundAndJoin(circle, bob);
        _fundAndJoin(circle, carol);

        // Round 0: everyone bids 0 discount (simplest case), forces VRF tie-break.
        bytes32 saltA = "saltA"; bytes32 saltB = "saltB"; bytes32 saltC = "saltC";
        vm.prank(alice); circle.commit(keccak256(abi.encodePacked(uint256(0), saltA, alice)));
        vm.prank(bob);   circle.commit(keccak256(abi.encodePacked(uint256(0), saltB, bob)));
        vm.prank(carol); circle.commit(keccak256(abi.encodePacked(uint256(0), saltC, carol)));
        circle.advanceToReveal();
        vm.prank(alice); circle.reveal(0, saltA);
        vm.prank(bob);   circle.reveal(0, saltB);
        vm.prank(carol); circle.reveal(0, saltC);

        assertEq(uint256(circle.state()), uint256(Circle.State.DRAW));
        circle.requestDraw();
        circle.fulfillRandomness(0, 42, "");

        // Round 1 has started (assuming not last round — 3 seats, round 0 done, 2 more).
        assertEq(uint256(circle.state()), uint256(Circle.State.COMMIT));
        assertEq(circle.currentRound(), 1);

        // Whichever of the three won round 0, they must show committed+revealed
        // already true for round 1 (auto-advanced), without calling commit/reveal.
        address r0Winner;
        if (circle.hasWon(alice)) r0Winner = alice;
        else if (circle.hasWon(bob)) r0Winner = bob;
        else r0Winner = carol;

        assertTrue(circle.committed(r0Winner), "past winner should be auto-committed");
        assertTrue(circle.revealed(r0Winner), "past winner should be auto-revealed");
        assertEq(circle.bidDiscount(r0Winner), 0, "past winner's auto-bid must be zero");
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/contracts && forge test --match-test test_pastWinnerAutoAdvancedNextRound -vv`
Expected: FAIL — `committed(r0Winner)` is `false` (not yet auto-marked); test may also fail earlier for unrelated reasons if bid-reveal encoding isn't wired yet (task 3 handles that) — if so, note the failure reason and proceed; this task's own fix will be verified again after task 3 lands. If the test cannot even compile/run because `reveal(0, salt)` behaves like a LUCKY_DRAW reveal (expects `amount == contribution`), that's expected — this test will only fully pass once Task 3 is also done. Treat Tasks 2 and 3 as landing together if strict TDD ordering is impractical; note this in the commit message.

- [ ] **Step 3: Write minimal implementation**

In `packages/contracts/src/Circle.sol`, inside the round-advance branch (the `else` block starting around line 464, after `currentRound++`), add auto-marking for past winners in AUCTION mode. Modify the loop that resets `committed`/`revealed`:

```solidity
        } else {
            // Advance to next round: reset per-round state
            currentRound++;
            drawRequestedAt = 0;
            revealCount = 0;
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
            roundStart = block.timestamp;
            state = State.COMMIT;
            emit RoundStarted(currentRound, roundStart);
        }
```

Note: `revealCount++` for auto-advanced winners is important — `_checkAllRevealed`'s `revealCount >= active` check must still trip correctly once the real bidders finish revealing (task 4 will re-verify this interacts correctly with `_activeCount()`, since past winners are still `joined == true`).

- [ ] **Step 4: Run test to verify it passes**

This test depends on Task 3's bid-reveal changes too — run after Task 3 is also implemented:
Run: `cd packages/contracts && forge test --match-test test_pastWinnerAutoAdvancedNextRound -vv`
Expected: PASS

- [ ] **Step 5: Commit** (combine with Task 3's commit if landed together — see Task 3)

---

## Task 3: Bid-reveal validation + highest-bid tracking (AUCTION mode)

**Why:** `reveal()` currently hardcodes `amount == contribution` (line 274), which is correct for LUCKY_DRAW but wrong for AUCTION (`amount` there is a bid discount, which can be any value from `0` up to the cap). Need to branch validation on `mode`, track the running highest bid/tie state as reveals come in, and enforce the 40% cap.

**Files:**
- Modify: `packages/contracts/src/Circle.sol:264-284` (`reveal` function)
- Test: `packages/contracts/test/Auction.t.sol` (add to the file created in Task 2)

- [ ] **Step 1: Write the failing test**

Add to `packages/contracts/test/Auction.t.sol`:

```solidity
    /// @notice In AUCTION mode, reveal() validates a bid discount (not the
    ///         contribution amount), stores it in bidDiscount[], and rejects
    ///         bids over the 40% cap. (Winner/tie derivation from bidDiscount[]
    ///         happens at draw time — see Task 4 — not here.)
    function test_revealStoresBidAndEnforcesCap() public {
        Circle circle = Circle(factory.createCircle(CONTRIB, SEATS, BOND, Mode.AUCTION));
        _fundAndJoin(circle, alice);
        _fundAndJoin(circle, bob);
        _fundAndJoin(circle, carol);
        // roundPool after all three commit = 3 * CONTRIB = 300e6; cap = 40% = 120e6

        bytes32 saltA = "saltA"; bytes32 saltB = "saltB"; bytes32 saltC = "saltC";
        uint256 bidAlice = 50e6;  // 50 mUSDC discount
        uint256 bidBob   = 80e6;
        uint256 bidCarol = 121e6; // exceeds 40% cap of 120e6 — must revert on reveal

        vm.prank(alice); circle.commit(keccak256(abi.encodePacked(bidAlice, saltA, alice)));
        vm.prank(bob);   circle.commit(keccak256(abi.encodePacked(bidBob, saltB, bob)));
        vm.prank(carol); circle.commit(keccak256(abi.encodePacked(bidCarol, saltC, carol)));
        circle.advanceToReveal();

        vm.prank(alice); circle.reveal(bidAlice, saltA);
        assertEq(circle.bidDiscount(alice), bidAlice);

        vm.prank(bob); circle.reveal(bidBob, saltB);
        assertEq(circle.bidDiscount(bob), bidBob);

        vm.prank(carol);
        vm.expectRevert(Circle.BidExceedsCap.selector);
        circle.reveal(bidCarol, saltC);
    }

    /// @notice Bid exactly at the 40% cap is accepted; one wei over reverts.
    ///         Boundary check for the cap enforcement in reveal().
    function test_bidAtCapAccepted_overCapReverts() public {
        Circle circle = Circle(factory.createCircle(CONTRIB, SEATS, BOND, Mode.AUCTION));
        _fundAndJoin(circle, alice);
        _fundAndJoin(circle, bob);
        _fundAndJoin(circle, carol);
        // roundPool = 300e6, cap = 120e6 exactly

        bytes32 saltA = "saltA"; bytes32 saltB = "saltB"; bytes32 saltC = "saltC";
        vm.prank(alice); circle.commit(keccak256(abi.encodePacked(uint256(120e6), saltA, alice)));
        vm.prank(bob);   circle.commit(keccak256(abi.encodePacked(uint256(120e6 + 1), saltB, bob)));
        vm.prank(carol); circle.commit(keccak256(abi.encodePacked(uint256(0), saltC, carol)));
        circle.advanceToReveal();

        vm.prank(alice); circle.reveal(120e6, saltA); // exactly at cap — must succeed
        assertEq(circle.bidDiscount(alice), 120e6);

        vm.prank(bob);
        vm.expectRevert(Circle.BidExceedsCap.selector);
        circle.reveal(120e6 + 1, saltB); // 1 wei over cap — must revert
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/contracts && forge test --match-test "test_revealStoresBidAndEnforcesCap|test_bidAtCapAccepted_overCapReverts" -vv`
Expected: FAIL — `bidDiscount(...)` remains zero since `reveal()` doesn't populate it yet, and there's no `BidExceedsCap` error defined yet (compile error) — expected at this stage.

- [ ] **Step 3: Write minimal implementation**

In `packages/contracts/src/Circle.sol`:

1. Add a new error near the other errors (after line 45's former location, now wherever `AuctionNotImplemented` was removed — just add alongside `InvalidReveal`):
   ```solidity
   error BidExceedsCap();
   ```

2. Replace the `reveal` function body (lines 266-284) with mode-branched validation:

```solidity
    function reveal(uint256 amount, bytes32 salt) external nonReentrant {
        if (state != State.REVEAL) revert NotRevealPhase();
        if (!memberInfo[msg.sender].joined) revert NotMember();
        if (!committed[msg.sender]) revert NotCommitted();
        if (revealed[msg.sender]) revert AlreadyRevealed();

        bytes32 expected = keccak256(abi.encodePacked(amount, salt, msg.sender));
        if (expected != commitmentOf[msg.sender]) revert InvalidReveal();

        if (mode == Mode.LUCKY_DRAW) {
            if (amount != contribution) revert InvalidReveal();
        } else {
            // AUCTION: `amount` is the bid discount, capped at 40% of this
            // round's pot. hasWon members should never reach here (they are
            // auto-marked revealed at round start — see fulfillRandomness).
            // Note: highest-bid/tie state is deliberately NOT tracked
            // incrementally here — it is recomputed from bidDiscount[] at draw
            // time in fulfillRandomness (Task 4), so there is exactly one
            // source of truth for "who is winning" and no risk of the running
            // tracker drifting out of sync with the actual revealed bids.
            uint256 cap = (roundPool * MAX_BID_DISCOUNT_BPS) / 10000;
            if (amount > cap) revert BidExceedsCap();
            bidDiscount[msg.sender] = amount;
        }

        // CEI
        revealed[msg.sender] = true;
        revealCount++;

        emit Revealed(msg.sender, currentRound);

        // Check if all active members have revealed → advance to DRAW
        _checkAllRevealed();
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/contracts && forge test --match-test "test_revealStoresBidAndEnforcesCap|test_bidAtCapAccepted_overCapReverts" -vv`
Expected: PASS

Then re-run Task 2's test (now that both land together):
Run: `cd packages/contracts && forge test --match-test test_pastWinnerAutoAdvancedNextRound -vv`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/Circle.sol packages/contracts/test/Auction.t.sol
git commit -m "feat(contracts): auction bid-reveal validation, cap, and highest-bid tracking"
```

---

## Task 4: Auction winner selection + dividend distribution in `fulfillRandomness`

**Why:** This is the core of the feature. `fulfillRandomness` currently always picks the winner via `randomness % eligibleCount` (LUCKY_DRAW behavior). For AUCTION, it must instead: pick the highest bidder if unique; fall back to VRF-random selection among tied-highest bidders (or all eligible members if nobody bid above zero / no reveals came from real bidders) if tied; then distribute `highestBid` as a pro-rata dividend to all joined members before crediting the winner's discounted pot.

**Files:**
- Modify: `packages/contracts/src/Circle.sol:367-478` (`fulfillRandomness`)
- Test: `packages/contracts/test/Auction.t.sol`

- [ ] **Step 1: Write the failing test**

Add to `packages/contracts/test/Auction.t.sol`:

```solidity
    /// @notice Full auction round: highest bidder wins the discounted pot,
    ///         and the discount is distributed pro-rata to ALL joined members
    ///         (including the winner), matching real chit-fund dividend rules.
    function test_highestBidderWinsAndDividendDistributed() public {
        Circle circle = Circle(factory.createCircle(CONTRIB, SEATS, BOND, Mode.AUCTION));
        _fundAndJoin(circle, alice);
        _fundAndJoin(circle, bob);
        _fundAndJoin(circle, carol);
        // roundPool = 300e6 after all commit

        bytes32 saltA = "saltA"; bytes32 saltB = "saltB"; bytes32 saltC = "saltC";
        uint256 bidAlice = 30e6;
        uint256 bidBob   = 90e6; // highest, unique — bob should win outright, no VRF tie-break needed
        uint256 bidCarol = 10e6;

        vm.prank(alice); circle.commit(keccak256(abi.encodePacked(bidAlice, saltA, alice)));
        vm.prank(bob);   circle.commit(keccak256(abi.encodePacked(bidBob, saltB, bob)));
        vm.prank(carol); circle.commit(keccak256(abi.encodePacked(bidCarol, saltC, carol)));
        circle.advanceToReveal();
        vm.prank(alice); circle.reveal(bidAlice, saltA);
        vm.prank(bob);   circle.reveal(bidBob, saltB);
        vm.prank(carol); circle.reveal(bidCarol, saltC);

        assertEq(uint256(circle.state()), uint256(Circle.State.DRAW));
        circle.requestDraw();
        circle.fulfillRandomness(0, 999, ""); // randomness irrelevant — bob wins outright, no tie

        assertTrue(circle.hasWon(bob), "highest unique bidder must win");
        assertFalse(circle.hasWon(alice));
        assertFalse(circle.hasWon(carol));

        // Winner's payout = roundPool - discount = 300e6 - 90e6 = 210e6
        assertEq(circle.memberInfo(bob).claimable, 210e6, "winner gets pot minus their own discount");

        // Discount (90e6) split pro-rata across all 3 joined members (incl. bob) = 30e6 each
        assertEq(circle.memberInfo(alice).claimable, 30e6, "alice gets dividend share");
        assertEq(circle.memberInfo(carol).claimable, 30e6, "carol gets dividend share");
        // bob's total claimable = 210e6 (pot) + 30e6 (own dividend share) = 240e6
    }

    /// @notice No one places a positive bid (or all bid 0, tied) → falls back
    ///         to a VRF-random draw among eligible members at zero discount,
    ///         exactly like the real "lottery when no one bids" rule.
    function test_noBidsFallsBackToVrfDraw() public {
        Circle circle = Circle(factory.createCircle(CONTRIB, SEATS, BOND, Mode.AUCTION));
        _fundAndJoin(circle, alice);
        _fundAndJoin(circle, bob);
        _fundAndJoin(circle, carol);

        bytes32 saltA = "saltA"; bytes32 saltB = "saltB"; bytes32 saltC = "saltC";
        vm.prank(alice); circle.commit(keccak256(abi.encodePacked(uint256(0), saltA, alice)));
        vm.prank(bob);   circle.commit(keccak256(abi.encodePacked(uint256(0), saltB, bob)));
        vm.prank(carol); circle.commit(keccak256(abi.encodePacked(uint256(0), saltC, carol)));
        circle.advanceToReveal();
        vm.prank(alice); circle.reveal(0, saltA);
        vm.prank(bob);   circle.reveal(0, saltB);
        vm.prank(carol); circle.reveal(0, saltC);

        circle.requestDraw();
        circle.fulfillRandomness(0, 1, ""); // randomness picks among the 3-way tie at bid=0

        // Exactly one of the three won; full pot (no discount) paid; dividends are all zero.
        uint256 wins = (circle.hasWon(alice) ? 1 : 0) + (circle.hasWon(bob) ? 1 : 0) + (circle.hasWon(carol) ? 1 : 0);
        assertEq(wins, 1, "exactly one member should win via VRF tie-break");
    }

    /// @notice A tie at a POSITIVE top bid must restrict the VRF lottery to
    ///         only the tied top bidders — an untied low/zero bidder must
    ///         never be selectable, and the discount credited must be the
    ///         tied topBid amount (a tie is not the same as "no one bid").
    ///         This is the critical case that distinguishes correct
    ///         tied-subset selection from an incorrect full-eligible-set draw.
    function test_tiedTopBidRestrictsLotteryToTiedBidders() public {
        Circle circle = Circle(factory.createCircle(CONTRIB, SEATS, BOND, Mode.AUCTION));
        _fundAndJoin(circle, alice);
        _fundAndJoin(circle, bob);
        _fundAndJoin(circle, carol);
        // roundPool = 300e6. Alice and bob tie at 50e6 (the top bid); carol
        // bids only 10e6 and must NEVER be selectable as winner here.

        bytes32 saltA = "saltA"; bytes32 saltB = "saltB"; bytes32 saltC = "saltC";
        vm.prank(alice); circle.commit(keccak256(abi.encodePacked(uint256(50e6), saltA, alice)));
        vm.prank(bob);   circle.commit(keccak256(abi.encodePacked(uint256(50e6), saltB, bob)));
        vm.prank(carol); circle.commit(keccak256(abi.encodePacked(uint256(10e6), saltC, carol)));
        circle.advanceToReveal();
        vm.prank(alice); circle.reveal(50e6, saltA);
        vm.prank(bob);   circle.reveal(50e6, saltB);
        vm.prank(carol); circle.reveal(10e6, saltC);

        circle.requestDraw();
        // Run this exact scenario across several randomness seeds — regardless
        // of seed, carol (untied, lower bid) must never win, and the winner's
        // payout must reflect the tied 50e6 discount, not zero.
        circle.fulfillRandomness(0, 3, "");

        assertFalse(circle.hasWon(carol), "untied lower bidder must never win a tied round");
        bool aliceWon = circle.hasWon(alice);
        bool bobWon   = circle.hasWon(bob);
        assertTrue(aliceWon != bobWon, "exactly one of the tied bidders must win");

        address winner = aliceWon ? alice : bob;
        // Winner's payout = pot - discount = 300e6 - 50e6 = 250e6, plus their
        // own share of the dividend (added below), since the winner is also
        // one of the `n` joined members in the dividend distribution loop.
        // Discount (50e6) split pro-rata across all 3 joined members: 50e6/3
        // = 16_666_666 per member with 2 wei dust → dustAccrued.
        uint256 sharePerMember = 50e6 / 3;
        assertEq(
            circle.memberInfo(winner).claimable,
            250e6 + sharePerMember,
            "winner must be credited (pot - TIED bid) plus their own dividend share, not zero discount"
        );
        // carol (non-winner, non-tied, lower bid) must still receive her
        // dividend share of the tied discount — proves the dividend is paid
        // on the real tied topBid, not silently zeroed by an untied draw.
        assertEq(circle.memberInfo(carol).claimable, sharePerMember, "carol must receive her dividend share of the tied discount");
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/contracts && forge test --match-test "test_highestBidderWinsAndDividendDistributed|test_noBidsFallsBackToVrfDraw|test_tiedTopBidRestrictsLotteryToTiedBidders" -vv`
Expected: FAIL — winner selection still uses pure `randomness % eligibleCount` regardless of bids; no dividend distribution exists yet.

- [ ] **Step 3: Write minimal implementation**

In `packages/contracts/src/Circle.sol`, replace the winner-selection block inside `fulfillRandomness` (originally lines 403-412: the `CEI: update state before transfers` block) with mode-branched logic:

```solidity
        // CEI: update state before transfers
        address winner;
        uint256 discount;

        if (mode == Mode.LUCKY_DRAW) {
            uint256 winnerIdx = randomness % eligibleCount;
            winner = eligible[winnerIdx];
            discount = 0;
        } else {
            // AUCTION: recompute the highest bid and the set of eligible
            // members tied at that bid directly from bidDiscount[], scanning
            // only `eligible` (already joined && !hasWon). This is the single
            // source of truth for "who's winning" — nothing upstream latches
            // a running "highest so far" value that could drift out of sync.
            uint256 topBid = 0;
            uint256 tiedCount = 0;
            for (uint256 i = 0; i < eligibleCount; i++) {
                uint256 b = bidDiscount[eligible[i]];
                if (b > topBid) {
                    topBid = b;
                    tiedCount = 1;
                } else if (b == topBid) {
                    tiedCount++;
                }
            }

            if (topBid > 0 && tiedCount == 1) {
                // Unique highest positive bidder wins outright, no VRF needed.
                for (uint256 i = 0; i < eligibleCount; i++) {
                    if (bidDiscount[eligible[i]] == topBid) {
                        winner = eligible[i];
                        break;
                    }
                }
                discount = topBid;
            } else if (topBid > 0) {
                // Genuine tie at a positive top bid: the real-world lottery
                // is held ONLY among the tied top bidders, not the whole
                // eligible set — an untied low/zero bidder must never be
                // selectable here, and the discount is still the tied topBid
                // (a tie doesn't mean "no one bid"; it means multiple members
                // bid the same winning amount). Build the tied subset, then
                // draw the VRF index over just that subset.
                address[] memory tied = new address[](tiedCount);
                uint256 tiedIdx = 0;
                for (uint256 i = 0; i < eligibleCount; i++) {
                    if (bidDiscount[eligible[i]] == topBid) {
                        tied[tiedIdx++] = eligible[i];
                    }
                }
                winner = tied[randomness % tiedCount];
                discount = topBid;
            } else {
                // topBid == 0: either nobody bid above zero, or (degenerate,
                // eligibleCount == 1) the sole remaining member's own bid is
                // zero. Either way, fall back to VRF over the FULL eligible
                // set at zero discount — matching the real-world "lottery
                // when nobody bids" rule (as opposed to the tie case above,
                // which is restricted to the tied bidders only).
                uint256 winnerIdx = randomness % eligibleCount;
                winner = eligible[winnerIdx];
                discount = 0;
            }
        }

        hasWon[winner] = true;

        uint256 pot = roundPool;
        roundPool = 0;

        if (discount > 0) {
            // Distribute the discount as a dividend to ALL joined members,
            // including the winner (real-world chit-fund dividend rule).
            // No organizer/foreman commission — Bhishi is fee-free by design.
            uint256 joinedForDividend = _activeCount();
            uint256 sharePerMember = discount / joinedForDividend;
            uint256 dividendDust = discount - sharePerMember * joinedForDividend;
            for (uint256 i = 0; i < n; i++) {
                address m = members[i];
                if (memberInfo[m].joined) {
                    memberInfo[m].claimable += sharePerMember;
                }
            }
            dustAccrued += dividendDust;
            memberInfo[winner].claimable += (pot - discount);
        } else {
            memberInfo[winner].claimable += pot;
        }

        emit WinnerDrawn(currentRound, winner, randomness);
```

Note: this replaces the old two lines (`hasWon[winner] = true;` and the pot-crediting line) — make sure not to duplicate them; the rest of the function (lastRound detection, dust/bond return, reputation attestation, round-advance) is unchanged from the existing code, since it already just reads `hasWon`/`memberInfo[...].claimable`/`members` generically regardless of how the winner was chosen. No separate reset of "highest bid" tracking variables is needed anywhere (Task 2 already clears `bidDiscount[m]` per-member on round-advance; there is no other auction-specific state to reset since Task 4's winner selection reads `bidDiscount[]` fresh every time rather than maintaining a running tracker).

Add one more test for the single-remaining-bidder edge case in the final round (flagged explicitly, not just asserted-by-implication):

```solidity
    /// @notice When only one eligible (non-winner) member remains, they win
    ///         outright regardless of their bid — no real "auction" needed,
    ///         and the VRF-tie-break branch must still resolve correctly for
    ///         a 1-element eligible set.
    function test_soleRemainingBidderWinsFinalRound() public {
        Circle circle = Circle(factory.createCircle(CONTRIB, SEATS, BOND, Mode.AUCTION));
        _fundAndJoin(circle, alice);
        _fundAndJoin(circle, bob);
        _fundAndJoin(circle, carol);

        // Run rounds 0 and 1 with everyone bidding 0 (VRF tie-break each time)
        // until only one non-winner remains for round 2.
        address[3] memory ppl = [alice, bob, carol];
        for (uint256 round = 0; round < 2; round++) {
            for (uint256 i = 0; i < 3; i++) {
                address who = ppl[i];
                if (circle.hasWon(who)) continue;
                bytes32 salt = bytes32(uint256(round * 10 + i));
                vm.prank(who); circle.commit(keccak256(abi.encodePacked(uint256(0), salt, who)));
            }
            circle.advanceToReveal();
            for (uint256 i = 0; i < 3; i++) {
                address who = ppl[i];
                if (circle.hasWon(who)) continue;
                bytes32 salt = bytes32(uint256(round * 10 + i));
                vm.prank(who); circle.reveal(0, salt);
            }
            circle.requestDraw();
            circle.fulfillRandomness(0, uint256(keccak256(abi.encodePacked(round, block.timestamp))), "");
        }

        // Exactly one member has not yet won — find them.
        address lastBidder;
        uint256 nonWinners = 0;
        for (uint256 i = 0; i < 3; i++) {
            if (!circle.hasWon(ppl[i])) { lastBidder = ppl[i]; nonWinners++; }
        }
        assertEq(nonWinners, 1, "exactly one member should remain before the final round");
        assertEq(uint256(circle.state()), uint256(Circle.State.COMMIT));

        bytes32 saltFinal = "final";
        vm.prank(lastBidder); circle.commit(keccak256(abi.encodePacked(uint256(50e6), saltFinal, lastBidder)));
        circle.advanceToReveal();
        vm.prank(lastBidder); circle.reveal(50e6, saltFinal);

        circle.requestDraw();
        circle.fulfillRandomness(0, 777, "");

        assertTrue(circle.hasWon(lastBidder), "sole remaining bidder must win outright");
        assertEq(uint256(circle.state()), uint256(Circle.State.COMPLETED));
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/contracts && forge test --match-test "test_highestBidderWinsAndDividendDistributed|test_noBidsFallsBackToVrfDraw|test_tiedTopBidRestrictsLotteryToTiedBidders|test_soleRemainingBidderWinsFinalRound" -vv`
Expected: PASS

Run the full new test file:
Run: `cd packages/contracts && forge test --match-contract AuctionTest -vv`
Expected: all tests from Tasks 2-4 PASS

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/Circle.sol packages/contracts/test/Auction.t.sol
git commit -m "feat(contracts): auction winner selection + pro-rata dividend distribution"
```

---

## Task 5: Full-cycle auction test (multi-round, completion, conservation check)

**Why:** Tasks 2-4 test individual round mechanics in isolation. This task proves a complete 3-seat AUCTION circle runs end-to-end (every member eventually wins exactly once, bonds are returned, reputation attested) and that total token balance is conserved throughout — the same guarantee `ConservationInv.t.sol` already proves for LUCKY_DRAW.

**Files:**
- Test: `packages/contracts/test/Auction.t.sol`

- [ ] **Step 1: Write the failing test**

Add to `packages/contracts/test/Auction.t.sol`:

```solidity
    /// @notice Full 3-round auction circle: every member wins exactly once,
    ///         circle reaches COMPLETED, bonds returned, balances conserved.
    function test_fullAuctionCycleConservesBalance() public {
        Circle circle = Circle(factory.createCircle(CONTRIB, SEATS, BOND, Mode.AUCTION));
        _fundAndJoin(circle, alice);
        _fundAndJoin(circle, bob);
        _fundAndJoin(circle, carol);

        address[3] memory ppl = [alice, bob, carol];
        uint256[3] memory bids = [uint256(10e6), uint256(20e6), uint256(30e6)];

        for (uint256 round = 0; round < SEATS; round++) {
            for (uint256 i = 0; i < 3; i++) {
                address who = ppl[i];
                if (circle.hasWon(who)) continue; // auto-advanced, already committed/revealed
                bytes32 salt = bytes32(uint256(round * 10 + i));
                // Bid amount doesn't matter for conservation — just must be under cap.
                vm.prank(who); circle.commit(keccak256(abi.encodePacked(bids[i], salt, who)));
            }
            circle.advanceToReveal();
            for (uint256 i = 0; i < 3; i++) {
                address who = ppl[i];
                if (circle.hasWon(who)) continue;
                bytes32 salt = bytes32(uint256(round * 10 + i));
                vm.prank(who); circle.reveal(bids[i], salt);
            }
            circle.requestDraw();
            circle.fulfillRandomness(0, uint256(keccak256(abi.encodePacked(round))), "");

            // Conservation check after every round: contract balance must equal
            // sum of all claimables + dust + undrawn pool (mirrors ConservationInv.t.sol).
            uint256 totalClaimable = circle.memberInfo(alice).claimable
                + circle.memberInfo(bob).claimable
                + circle.memberInfo(carol).claimable;
            uint256 totalBonds = circle.memberInfo(alice).stakedBond
                + circle.memberInfo(bob).stakedBond
                + circle.memberInfo(carol).stakedBond;
            assertEq(
                stable.balanceOf(address(circle)),
                totalClaimable + circle.dustAccrued() + circle.undrawnPools() + totalBonds,
                "conservation invariant violated mid-auction-cycle"
            );
        }

        assertEq(uint256(circle.state()), uint256(Circle.State.COMPLETED));
        assertTrue(circle.hasWon(alice));
        assertTrue(circle.hasWon(bob));
        assertTrue(circle.hasWon(carol));
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/contracts && forge test --match-test test_fullAuctionCycleConservesBalance -vv`
Expected: likely PASS already if Tasks 2-4 are correctly implemented (this is primarily a regression/integration proof, not new functionality) — if it fails, debug against Tasks 2-4's logic rather than adding new implementation code; a failure here indicates a bug in the earlier tasks, not a missing feature.

- [ ] **Step 3 (conditional): Fix any bug surfaced**

If the test fails, the most likely causes to check:
- `_activeCount()` inside the dividend-distribution loop in Task 4 may be stale if called after `hasWon[winner] = true` is set but before `roundPool = 0` — verify the dividend divides by the count of joined members *before* this round's payout changes joined-status (it shouldn't change joined-status at all in AUCTION — only LUCKY_DRAW's slash path does that — so this should be fine, but verify).
- Auto-advanced past winners (Task 2) must not be included in `eligible[]` (they have `hasWon[m] == true`, already excluded by the existing `eligible` construction loop — verify no double-counting).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/contracts && forge test --match-test test_fullAuctionCycleConservesBalance -vv`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/test/Auction.t.sol
git commit -m "test(contracts): full-cycle auction conservation proof"
```

---

## Task 6: Extend the stateful invariant fuzzer to cover AUCTION mode

**Why:** `ConservationInv.t.sol` currently only fuzzes a LUCKY_DRAW circle. Since AUCTION introduces a new money-movement path (dividend distribution), the existing invariant (`balance == totalClaimable + dustAccrued + undrawnPools + totalBonds`) must be proven to hold under random AUCTION-mode action sequences too, not just asserted true in the one hand-written test from Task 5.

**Files:**
- Read first: `packages/contracts/test/ConservationInv.t.sol` (full file, to understand `CircleHandler`'s structure before modifying)
- Modify: `packages/contracts/test/ConservationInv.t.sol`

- [ ] **Step 1: Read the existing invariant test file**

Run: `cat packages/contracts/test/ConservationInv.t.sol` (or use the Read tool) to understand the exact `CircleHandler` action set, constructor params, and how `mode` is currently hardcoded to `Mode.LUCKY_DRAW`, before making changes. Do not skip this — the handler's bid-related actions must call `commit`/`reveal` with valid bid amounts under the 40% cap, or every run will revert and the fuzzer will report false-negative "no invariant violation" results (reverts inside a handler function are typically caught/ignored by forge's invariant runner, which would silently make this test meaningless rather than failing loudly — confirm how the existing handler handles LUCKY_DRAW reverts, e.g. via try/catch, and mirror that pattern for AUCTION's `BidExceedsCap`).

- [ ] **Step 2: Write the failing test**

Add a second invariant test function (alongside the existing one) that runs the same handler against an AUCTION-mode circle instead of LUCKY_DRAW. Exact code depends on the existing handler's constructor signature (read in Step 1) — parameterize `Mode` as a handler constructor argument if not already, defaulting existing call sites to `Mode.LUCKY_DRAW` explicitly to avoid changing current test behavior, and add a new `invariant_conservationHoldsAuction` (or similarly named) test wired to a handler constructed with `Mode.AUCTION`.

If the handler's bid/reveal action currently always reveals `contribution` as the amount (correct for LUCKY_DRAW), add a mode-aware branch: when the underlying circle's `mode() == Mode.AUCTION`, the handler's reveal action must exercise these specific bid distributions across its fuzz runs — do not settle for a happy-path-only bid (e.g. always `roundPool/10`), since that would let the fuzzer report a false "all clear" without ever stressing the actual risk areas:

1. **Bids exactly at the cap and one wei over** — bound the handler's random bid to occasionally hit exactly `roundPool * 4000 / 10000` (must succeed) and occasionally attempt `cap + 1` (must revert with `BidExceedsCap`, caught by the handler's existing revert-tolerance pattern from Step 1 — confirm the revert is actually reached and not swallowed by an earlier unrelated require).
2. **Forced multi-way ties** — periodically (e.g. every Nth call, driven by the fuzzer's own call sequence rather than hardcoded) have 2+ members in the same round reveal the identical bid value, to exercise the tie → VRF-fallback branch in `fulfillRandomness` repeatedly, not just once.
3. **Zero-bid and mixed zero/positive rounds** — some rounds where every remaining bidder reveals exactly `0`, and some where one bids `0` and another bids positive, to exercise both the "no bids at all" and "one real bid among zero-bidders" paths.
4. **`eligibleCount == 1`** — the handler should let a circle run down to its final round naturally (this already happens if the fuzzer runs enough calls per circle) and assert the invariant still holds when only one non-winner remains, exercising the same edge case as Task 4's `test_soleRemainingBidderWinsFinalRound` but under randomized round history instead of a fixed hand-written sequence.

Do not treat this task as complete if the handler only ever submits one fixed bid pattern — the point of the invariant fuzzer is exercising combinations a hand-written test wouldn't think to try.

- [ ] **Step 3: Run test to verify it fails or passes cleanly**

Run: `cd packages/contracts && forge test --match-test invariant_conservationHoldsAuction -vv`
Expected: either PASS (if Tasks 2-5's implementation is correct and the invariant holds under all four scenario classes above) or FAIL with a clear counterexample call sequence (forge prints the failing call sequence — use it to identify which of the four scenario classes triggered the break, e.g. dividend dust miscounted when `_activeCount()` is 1, or a tie-detection bug in the `bidDiscount[]` scan). If it fails, fix the root cause in `Circle.sol`, not the test. Re-run with `--fail-on-revert` toggled per the existing file's convention (checked in Step 1) to confirm the failure is a genuine invariant violation, not a swallowed revert.

- [ ] **Step 4: Run full test suite**

Run: `cd packages/contracts && forge test`
Expected: all tests pass, including the pre-existing 52 and all new AUCTION tests.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/test/ConservationInv.t.sol
git commit -m "test(contracts): extend conservation invariant fuzzer to AUCTION mode"
```

---

## Task 7: Update deploy/demo scripts and docs to reflect working AUCTION mode

**Files:**
- Modify: `docs/architecture-spec.md` — §6's "Auction mode (optional 2nd mode...)" paragraph currently describes this as aspirational; update to reflect it's implemented, matching the actual mechanics built (highest-bid-wins with VRF tie-break/no-bid fallback, dividend to all members, no organizer commission, 40% cap, permanent winner exclusion)
- No change expected to `packages/contracts/script/SeedDemo.s.sol` (stays LUCKY_DRAW for the existing demo money-shots — confirmed out of scope per this plan's File Structure section) — verify this assumption still holds and note if the user wants an AUCTION demo path added later (separate follow-up, not this plan)

- [ ] **Step 1: Update architecture-spec.md §6**

Read the current §6 text (`docs/architecture-spec.md`, "Auction mode (optional 2nd mode..." paragraph) and replace it with an accurate description matching what was actually built:

```markdown
- **Auction mode (`mode == AUCTION`, implemented):** each round, non-winning members submit sealed
  bids via the same commit-reveal machinery (bid = discount they'll accept off the round pot,
  capped at 40% of the pot — standard chit-fund convention). Highest revealed bid wins the
  discounted pot; ties (or an all-zero/no-bid round) fall back to Gelato VRF among the tied/eligible
  set, exactly mirroring the real-world "lottery when nobody bids" rule. The discount is distributed
  as a pro-rata dividend to **every** joined member, including that round's winner and past
  winners — no organizer/foreman commission, matching Bhishi's fee-free design. Once a member wins,
  they are permanently excluded from future bidding ("prized subscriber" rule), continuing to pay
  contributions and receive dividends until the circle completes. Winners still pay their full
  round contribution regardless of their bid — unchanged from LUCKY_DRAW.
```

- [ ] **Step 2: Verify no other doc references the old "not yet implemented" framing**

Run: `grep -rn "AUCTION" docs/ packages/contracts/README.md 2>/dev/null` (if a package-level README exists) and update any other stale "roadmap"/"not implemented" mentions found.

- [ ] **Step 3: Commit**

```bash
git add docs/architecture-spec.md
git commit -m "docs: update architecture-spec to reflect implemented AUCTION mode"
```

---

## Final verification

- [ ] Run the complete test suite one more time end-to-end: `cd packages/contracts && forge test -vv`
  Expected: all tests pass (pre-existing 52 + new AUCTION tests + extended invariant fuzzer), zero failures.
- [ ] Run `forge build` to confirm a clean compile with no new warnings introduced beyond the pre-existing lint notes.
- [ ] Confirm `grep -rn "AuctionNotImplemented" packages/contracts` returns zero matches (fully removed, not just unused).
