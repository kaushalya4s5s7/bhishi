// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, StdInvariant, console} from "forge-std/Test.sol";
import {Circle, Mode} from "../src/Circle.sol";
import {CircleFactory} from "../src/CircleFactory.sol";
import {ReputationRegistry} from "../src/ReputationRegistry.sol";
import {MockStable} from "../src/MockStable.sol";
import {MockEntropy} from "./mocks/MockEntropy.sol";
import {VrfFixture} from "./mocks/VrfFixture.sol";

/// @notice Handler that drives Circle state transitions for invariant testing.
///         The invariant: circle.balanceOf == totalClaimable + dustAccrued + undrawnPools
///         at every point in the lifecycle.
///
///         Two families of actions are exposed to the fuzzer:
///
///         1. Fine-grained actions (join/commit/reveal/slash/...) — these let
///            the fuzzer interleave individual FSM steps in arbitrary orders,
///            catching odd partial-state sequences a scripted test wouldn't try.
///
///         2. A single guided `driveRound` action — this completes an entire
///            round (join everyone still needed, commit everyone, advance,
///            reveal everyone, request+fulfill the draw) in one call. It exists
///            because the deep states of this FSM (REVEAL / DRAW / dividend
///            distribution) are practically unreachable by a pure random walk:
///            Foundry reverts handler+EVM storage to the post-setUp snapshot
///            before EACH run, and reaching REVEAL requires a specific ~7-step
///            ordering (3 joins → 3 commits → advance → reveals) that almost
///            never lands within one run's call budget. Empirically, without a
///            guided driver the fuzzer got at most ONE actor joined per run and
///            never once reached COMMIT, let alone REVEAL — so the AUCTION
///            bid/cap/tie/dividend money-path was never exercised at all. The
///            guided driver makes those paths reachable while the fuzzer still
///            controls the bids (via `bidSeed`) and the draw randomness.
contract CircleHandler is Test, VrfFixture {
    Circle      public circle;
    MockStable  public stable;

    uint256 constant CONTRIB = 100e6;
    uint256 constant SEATS   = 3;
    uint256 constant BOND    = (SEATS - 1) * CONTRIB; // minimum valid bond

    bytes32 constant SALT = bytes32(uint256(0xABCD));

    address[] public actors;

    // AUCTION-mode bookkeeping: the bid chosen at commit() time must be
    // replayed exactly at reveal() time (reveal checks the commitment hash).
    mapping(address => uint256) public pendingBid;
    uint256 public callCount;

    // Coverage counters. NOTE: these reset to zero at the start of every
    // invariant *run* (Foundry snapshots storage post-setUp and reverts to it
    // between runs — verified empirically), so they only ever reflect a single
    // run's activity. The campaign-wide accumulation that the regression guard
    // asserts on is done in ConservationInvAuctionTest via the filesystem,
    // which is the only cheatcode-accessible state that survives the per-run
    // snapshot revert.
    uint256 public revealSuccessCount;
    uint256 public revealRevertCount;
    uint256 public capRevertCount;
    uint256 public roundsDriven;

    MockEntropy internal vrf;

    constructor(Circle _circle, MockStable _stable, MockEntropy _vrf) {
        vrf = _vrf;
        circle = _circle;
        stable = _stable;
        // Pre-approve
        for (uint160 i = 0; i < SEATS; i++) {
            address m = address(uint160(0x5000 + i));
            actors.push(m);
            deal(address(stable), m, BOND + CONTRIB * 100);
            vm.prank(m);
            stable.approve(address(circle), type(uint256).max);
        }
    }

    function _isAuction() internal view returns (bool) {
        return circle.mode() == Mode.AUCTION;
    }

    function _isJoined(address m) internal view returns (bool) {
        (bool joined,,,) = circle.memberInfo(m);
        return joined;
    }

    function _claimable(address m) internal view returns (uint256 c) {
        (,,, c) = circle.memberInfo(m);
    }

    function _state() internal view returns (uint256) {
        return uint256(circle.state());
    }

    // ── guided full-round driver ────────────────────────────────────────────
    /// @notice Drive one complete round from wherever the FSM currently is.
    ///         `bidSeed` selects a per-round bid pattern (AUCTION only) so the
    ///         cap-boundary, over-cap, zero-bid, and forced-tie code paths all
    ///         get exercised across the campaign. Every step is try/catch'd so
    ///         a deliberately-reverting bid (cap+1) doesn't abort the walk; the
    ///         conservation invariant is still checked by the test between the
    ///         individual state mutations that this driver triggers is not the
    ///         point — the invariant is re-asserted after this whole call, and
    ///         (more importantly) after every fine-grained action too.
    function driveRound(uint256 bidSeed) external {
        // 1. Make sure everyone has joined (FILLING → COMMIT once seats full).
        if (_state() == uint256(Circle.State.FILLING)) {
            for (uint256 i = 0; i < actors.length; i++) {
                address m = actors[i];
                if (_isJoined(m)) continue;
                vm.prank(m);
                try circle.join() {} catch {}
            }
        }

        // 2. COMMIT phase: every non-winner commits a bid; past winners are
        //    auto-advanced by the contract and must NOT be committed here.
        if (_state() != uint256(Circle.State.COMMIT)) return;

        // Cap is 40% of the FINAL round pool. In COMMIT, roundPool is still
        // being accumulated as each member commits their fixed contribution,
        // so we compute the cap from the deterministic final pool (count of
        // members still bidding this round * contribution) rather than the
        // in-flight roundPool(), otherwise early committers would see an
        // understated cap and the cap-boundary cases would be wrong.
        uint256 bidders = 0;
        for (uint256 i = 0; i < actors.length; i++) {
            if (!circle.hasWon(actors[i])) bidders++;
        }
        uint256 pool = bidders * CONTRIB;
        uint256 cap  = (pool * circle.MAX_BID_DISCOUNT_BPS()) / 10000;

        // Per-round bid pattern. Arms are chosen to cover the risk areas the
        // AUCTION logic must handle:
        //   0: everyone bids exactly at cap        (all-tied at the max)
        //   1: everyone bids 0                      (no-bid VRF fallback)
        //   2: distinct increasing bids            (unique highest winner)
        //   3: two tie at cap, rest lower          (tie → restricted VRF)
        //   4: first bidder over cap (must revert), rest valid distinct bids
        //
        // Round 0 of every fresh circle is FORCED to arm 4. Because Foundry
        // reverts handler+EVM storage to the post-setUp snapshot between runs,
        // every run starts at currentRound 0 — so pinning arm 4 there
        // guarantees the over-cap BidExceedsCap revert path is exercised on
        // essentially every run that reaches REVEAL, rather than depending on
        // a 1-in-5 seed roll coinciding with a round that happens to complete
        // (which, with only ~1 completed round per run, almost never happened
        // and left capRevertCount at 0 campaign-wide). Later rounds use the
        // seed-driven arm so cap/zero/tie/unique-winner variety is still fuzzed.
        uint256 arm = circle.currentRound() == 0 ? 4 : (bidSeed % 5);

        uint256 committedBidders = 0;
        for (uint256 i = 0; i < actors.length; i++) {
            address m = actors[i];
            if (circle.hasWon(m)) continue;          // auto-advanced past winner
            if (circle.committed(m)) continue;

            uint256 bid;
            if (arm == 0) {
                bid = cap;
            } else if (arm == 1) {
                bid = 0;
            } else if (arm == 2) {
                // Distinct increasing bids, all within cap.
                bid = cap == 0 ? 0 : (cap * (committedBidders + 1)) / (bidders + 1);
            } else if (arm == 3) {
                // First two tie at cap; remainder bid lower (half cap).
                bid = committedBidders < 2 ? cap : cap / 2;
            } else {
                // arm == 4: the first bidder attempts cap+1 (must revert on
                // reveal), the rest bid distinct valid amounts.
                bid = committedBidders == 0 ? cap + 1 : (cap == 0 ? 0 : (cap * (committedBidders)) / (bidders + 1));
            }

            pendingBid[m] = bid;
            bytes32 c = keccak256(abi.encodePacked(bid, SALT, m));
            vm.prank(m);
            try circle.commit(c) {} catch {}
            committedBidders++;
        }

        // 3. Advance COMMIT → REVEAL.
        try circle.advanceToReveal() {} catch {}
        if (_state() != uint256(Circle.State.REVEAL)) return;

        // 4. REVEAL: every non-winner reveals their pending bid. An over-cap
        //    bid (arm 4's first bidder) reverts with BidExceedsCap here — that
        //    member stays un-revealed and will be slashable, which is itself a
        //    valid state the invariant must hold through.
        for (uint256 i = 0; i < actors.length; i++) {
            address m = actors[i];
            if (circle.hasWon(m)) continue;
            if (!circle.committed(m)) continue;
            if (circle.revealed(m)) continue;
            vm.prank(m);
            try circle.reveal(pendingBid[m], SALT) {
                revealSuccessCount++;
            } catch (bytes memory reason) {
                revealRevertCount++;
                if (reason.length >= 4 && bytes4(reason) == Circle.BidExceedsCap.selector) {
                    capRevertCount++;
                }
            }
        }

        // 5. If a bid was rejected (arm 4), the offender never revealed, so the
        //    round is stuck in REVEAL until slashed. Slash them so the draw can
        //    proceed and the round completes (exercising the slash+auction
        //    interaction under conservation).
        if (_state() == uint256(Circle.State.REVEAL)) {
            vm.warp(block.timestamp + circle.REVEAL_WINDOW() + 1);
            for (uint256 i = 0; i < actors.length; i++) {
                address m = actors[i];
                if (circle.hasWon(m)) continue;
                if (circle.revealed(m)) continue;
                if (!_isJoined(m)) continue;
                try circle.slash(m) {} catch {}
            }
        }

        // 6. DRAW: request + fulfill. Randomness derived from the seed so the
        //    VRF tie-break / no-bid fallback picks vary across the campaign.
        if (_state() == uint256(Circle.State.DRAW)) {
            try circle.requestDraw() {} catch {}
            if (circle.drawRequestedAt() != 0) {
                try vrf.fulfillLatest(address(circle), uint256(keccak256(abi.encodePacked(bidSeed, callCount)))) {
                    roundsDriven++;
                } catch {}
            }
        }

        callCount++;
    }

    // ── fine-grained handlers (arbitrary interleaving coverage) ──────────────

    function join(uint256 actorIdx) external {
        if (_state() != uint256(Circle.State.FILLING)) return;
        actorIdx = actorIdx % actors.length;
        address m = actors[actorIdx];
        if (_isJoined(m)) return;
        vm.prank(m);
        try circle.join() {} catch {}
    }

    function commit(uint256 actorIdx, uint256 bidSeed) external {
        if (_state() != uint256(Circle.State.COMMIT)) return;
        actorIdx = actorIdx % actors.length;
        address m = actors[actorIdx];
        if (!_isJoined(m)) return;
        if (circle.hasWon(m)) return;
        if (circle.committed(m)) return;

        uint256 amount;
        if (_isAuction()) {
            uint256 bidders = 0;
            for (uint256 i = 0; i < actors.length; i++) {
                if (!circle.hasWon(actors[i])) bidders++;
            }
            uint256 pool = bidders * CONTRIB;
            uint256 cap  = (pool * circle.MAX_BID_DISCOUNT_BPS()) / 10000;
            amount = cap == 0 ? 0 : bidSeed % (cap + 2); // may exceed cap by 1 → revert path
            pendingBid[m] = amount;
        } else {
            amount = CONTRIB;
        }

        bytes32 c = keccak256(abi.encodePacked(amount, SALT, m));
        vm.prank(m);
        try circle.commit(c) {} catch {}
    }

    function advanceToReveal() external {
        if (_state() != uint256(Circle.State.COMMIT)) return;
        try circle.advanceToReveal() {} catch {}
    }

    function reveal(uint256 actorIdx) external {
        if (_state() != uint256(Circle.State.REVEAL)) return;
        actorIdx = actorIdx % actors.length;
        address m = actors[actorIdx];
        if (!_isJoined(m)) return;
        if (!circle.committed(m)) return;
        if (circle.revealed(m)) return;

        uint256 amount = _isAuction() ? pendingBid[m] : CONTRIB;
        vm.prank(m);
        try circle.reveal(amount, SALT) {
            revealSuccessCount++;
        } catch (bytes memory reason) {
            revealRevertCount++;
            if (reason.length >= 4 && bytes4(reason) == Circle.BidExceedsCap.selector) {
                capRevertCount++;
            }
        }
    }

    function slash(uint256 actorIdx) external {
        if (_state() != uint256(Circle.State.REVEAL)) return;
        actorIdx = actorIdx % actors.length;
        address defaulter = actors[actorIdx];
        if (!_isJoined(defaulter)) return;
        if (circle.revealed(defaulter)) return;
        vm.warp(block.timestamp + circle.REVEAL_WINDOW() + 1);
        try circle.slash(defaulter) {} catch {}
    }

    function requestDraw() external {
        if (_state() != uint256(Circle.State.DRAW)) return;
        if (circle.drawRequestedAt() != 0) return;
        try circle.requestDraw() {} catch {}
    }

    function fulfillRandomness(uint256 rand) external {
        if (_state() != uint256(Circle.State.DRAW)) return;
        if (circle.drawRequestedAt() == 0) return;
        try vrf.fulfillLatest(address(circle), rand) {} catch {}
    }

    function reclaimOnStall() external {
        if (_state() != uint256(Circle.State.DRAW)) return;
        if (circle.drawRequestedAt() == 0) return;
        vm.warp(block.timestamp + circle.VRF_TIMEOUT() + 1);
        try circle.reclaimOnStall() {} catch {}
    }

    function claim(uint256 actorIdx) external {
        actorIdx = actorIdx % actors.length;
        address m = actors[actorIdx];
        if (_claimable(m) == 0) return;
        vm.prank(m);
        try circle.claim() {} catch {}
    }

    function refundFilling() external {
        if (_state() != uint256(Circle.State.FILLING)) return;
        vm.warp(block.timestamp + circle.FILLING_TIMEOUT() + 1);
        try circle.refundFilling() {} catch {}
    }
}

/// @notice Invariant suite: conservation of value inside Circle.
///         LEAK 3 proof: every token that enters the circle is accounted for
///         in totalClaimable + dustAccrued + undrawnPools.
contract ConservationInvTest is StdInvariant, Test, VrfFixture {
    Circle          internal circle;
    MockStable      internal stable;
    MockEntropy         internal vrf;
    CircleHandler   internal handler;

    uint256 constant CONTRIB = 100e6;
    uint256 constant SEATS   = 3;
    uint256 constant BOND    = (SEATS - 1) * CONTRIB;

    function setUp() public {
        stable      = new MockStable();
        vrf         = new MockEntropy(VRF_FEE);
        address impl = address(new Circle());
        CircleFactory factory = new CircleFactory(impl, address(stable), address(0), address(vrf));
        circle = Circle(payable(factory.createCircle{value: VRF_BUDGET}(CONTRIB, SEATS, BOND, Mode.LUCKY_DRAW)));

        handler = new CircleHandler(circle, stable, vrf);

        targetContract(address(handler));
    }

    /// @notice Conservation invariant:
    ///         contract token balance == totalClaimable + dustAccrued + undrawnPools + bonds
    ///
    ///         This holds through every state transition because:
    ///         - join()       : bond enters → stakedBond
    ///         - commit()     : contribution enters → roundPool
    ///         - slash()      : bond redistributed to claimable / roundPool / dustAccrued
    ///         - fulfillRandomness(): roundPool → winner.claimable, bonds → claimable
    ///         - reclaimOnStall() : roundPool → claimable + dustAccrued
    ///         - claim()      : claimable exits → token leaves contract
    ///         Dust is released to first member on COMPLETED.
    function invariant_balanceEqualsClaims() public view {
        _checkConservation(circle, stable);
    }
}

/// @notice AUCTION-mode counterpart of ConservationInvTest. Wires a fresh
///         handler to an AUCTION-mode circle so the fuzzer exercises the
///         dividend-distribution money path (bids, ties, VRF fallback, cap
///         edges) under the same conservation invariant.
contract ConservationInvAuctionTest is StdInvariant, Test, VrfFixture {
    Circle          internal circle;
    MockStable      internal stable;
    MockEntropy         internal vrf;
    CircleHandler   internal handler;

    uint256 constant CONTRIB = 100e6;
    uint256 constant SEATS   = 3;
    uint256 constant BOND    = (SEATS - 1) * CONTRIB;

    // ── campaign-wide coverage accumulator (see rationale below) ─────────────
    //
    // Foundry reverts handler+EVM storage to the post-setUp() snapshot before
    // each independent invariant *run* within the campaign (verified with a
    // dedicated probe: a handler counter bumped on every call reads 500 — one
    // run's depth — at afterInvariant(), not 128_000). So:
    //   - handler.revealSuccessCount() only ever reflects the LAST run.
    //   - afterInvariant() fires exactly ONCE, after the last run.
    // A direct assertion on handler counters in afterInvariant() would there-
    // fore silently depend on the very last of ~256 runs happening to reach
    // REVEAL — flaky and unsound.
    //
    // The filesystem is the only cheatcode-accessible state that survives the
    // per-run snapshot revert. invariant_*() runs after EVERY call in EVERY
    // run, so we use it to persist a running max of the handler's cumulative
    // coverage counters across the whole campaign. afterInvariant() reads the
    // file once and asserts the campaign-wide totals are non-zero — this is
    // the regression guard against the "rubber stamp" failure mode where the
    // invariant passes without the AUCTION reveal/cap path ever being run.
    string constant LOG_PATH = "./cache/auction_campaign_accumulator.log";

    function setUp() public {
        stable      = new MockStable();
        vrf         = new MockEntropy(VRF_FEE);
        address impl = address(new Circle());
        CircleFactory factory = new CircleFactory(impl, address(stable), address(0), address(vrf));
        circle = Circle(payable(factory.createCircle{value: VRF_BUDGET}(CONTRIB, SEATS, BOND, Mode.AUCTION)));

        handler = new CircleHandler(circle, stable, vrf);

        // Only drive the guided round action + a few money-moving actions.
        // Restricting the selector set keeps each run's call budget focused on
        // actually completing rounds (reaching the dividend path) rather than
        // being spent on no-op fine-grained calls that revert-early in the
        // wrong FSM state. The fine-grained handlers still exist and are
        // exercised by the LUCKY_DRAW suite above with the full selector set.
        bytes4[] memory selectors = new bytes4[](3);
        selectors[0] = CircleHandler.driveRound.selector;
        selectors[1] = CircleHandler.claim.selector;
        selectors[2] = CircleHandler.reveal.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));

        // Clear any stale accumulator file from an interrupted previous run.
        try vm.removeFile(LOG_PATH) {} catch {}
    }

    /// @notice Conservation invariant under AUCTION mode. Also persists the
    ///         running-max of the handler's coverage counters to the campaign
    ///         accumulator file (see the LOG_PATH rationale above): this fn is
    ///         called after every call in every run, so it is the one place
    ///         that can observe per-run high-water marks before the next run's
    ///         snapshot revert wipes the handler's storage.
    function invariant_conservationHoldsAuction() public {
        _checkConservation(circle, stable);

        uint256 prevRevealOk;
        uint256 prevCapRev;
        try vm.readFile(LOG_PATH) returns (string memory content) {
            (prevRevealOk, prevCapRev) = _parseLog(content);
        } catch {}

        uint256 revealOk = handler.revealSuccessCount();
        uint256 capRev   = handler.capRevertCount();

        if (revealOk > prevRevealOk || capRev > prevCapRev) {
            uint256 nextRevealOk = revealOk > prevRevealOk ? revealOk : prevRevealOk;
            uint256 nextCapRev   = capRev > prevCapRev ? capRev : prevCapRev;
            vm.writeFile(LOG_PATH, string.concat(
                vm.toString(nextRevealOk), " ", vm.toString(nextCapRev)
            ));
        }
    }

    /// @notice Regression guard for the "rubber stamp" failure mode: if the
    ///         handler's action set regresses such that reveal() (and therefore
    ///         the bid-cap/tie/zero-bid logic) is never actually invoked across
    ///         the WHOLE campaign, this fails loudly instead of the invariant
    ///         silently "passing" on an untested code path.
    function afterInvariant() public {
        uint256 revealOk;
        uint256 capRev;
        try vm.readFile(LOG_PATH) returns (string memory content) {
            (revealOk, capRev) = _parseLog(content);
        } catch {}

        console.log("campaign revealSuccessCount (high-water)", revealOk);
        console.log("campaign capRevertCount (high-water)", capRev);

        assertGt(revealOk, 0, "reveal() was never successfully invoked across the whole AUCTION fuzz campaign");
        assertGt(capRev, 0, "over-cap bid revert path was never exercised across the whole AUCTION fuzz campaign");

        try vm.removeFile(LOG_PATH) {} catch {}
    }

    function _parseLog(string memory content) internal pure returns (uint256 revealOk, uint256 capRev) {
        bytes memory b = bytes(content);
        uint256 i;
        (revealOk, i) = _parseUint(b, 0);
        (capRev, ) = _parseUint(b, i + 1);
    }

    function _parseUint(bytes memory b, uint256 start) internal pure returns (uint256 value, uint256 i) {
        i = start;
        while (i < b.length && b[i] != 0x20) {
            value = value * 10 + (uint8(b[i]) - 48);
            i++;
        }
    }
}

/// @dev Shared conservation check used by both invariant suites.
function _checkConservation(Circle c, MockStable stable) view {
    uint256 contractBal  = stable.balanceOf(address(c));
    uint256 totalClaims  = c.totalClaimable();
    uint256 dust         = c.dustAccrued();
    uint256 undrawn      = c.undrawnPools();

    uint256 totalBonds = 0;
    uint256 n = c.memberCount();
    for (uint256 i = 0; i < n; i++) {
        address m = c.members(i);
        (bool joined, uint256 stakedBond,,) = c.memberInfo(m);
        if (joined) totalBonds += stakedBond;
    }

    require(
        contractBal == totalClaims + dust + undrawn + totalBonds,
        "conservation invariant violated"
    );
}
