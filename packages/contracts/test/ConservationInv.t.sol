// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, StdInvariant} from "forge-std/Test.sol";
import {Circle, Mode} from "../src/Circle.sol";
import {CircleFactory} from "../src/CircleFactory.sol";
import {ReputationRegistry} from "../src/ReputationRegistry.sol";
import {MockStable} from "../src/MockStable.sol";

/// @notice Handler that drives Circle state transitions for invariant testing.
///         The invariant: circle.balanceOf == totalClaimable + dustAccrued + undrawnPools
///         at every point in the lifecycle.
contract CircleHandler is Test {
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

    constructor(Circle _circle, MockStable _stable) {
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

    // ── handlers ──────────────────────────────────────────────────────────────

    function _isJoined(address m) internal view returns (bool) {
        (bool joined,,,) = circle.memberInfo(m);
        return joined;
    }

    function _claimable(address m) internal view returns (uint256 c) {
        (,,, c) = circle.memberInfo(m);
    }

    function join(uint256 actorIdx) external {
        if (uint256(circle.state()) != uint256(Circle.State.FILLING)) return;
        actorIdx = actorIdx % actors.length;
        address m = actors[actorIdx];
        if (_isJoined(m)) return;
        vm.prank(m);
        try circle.join() {} catch {}
    }

    function commit(uint256 actorIdx, uint256 bidSeed) external {
        callCount++;
        if (uint256(circle.state()) != uint256(Circle.State.COMMIT)) return;
        actorIdx = actorIdx % actors.length;
        address m = actors[actorIdx];
        if (!_isJoined(m)) return;
        if (circle.committed(m)) return;

        uint256 amount;
        if (_isAuction()) {
            // Mode-aware bid selection: exercise cap edges, ties, zero bids,
            // and mixed zero/positive bids across fuzz runs — not one fixed
            // happy-path bid.
            //
            // IMPORTANT: reveal()'s cap check uses roundPool() *at reveal
            // time*, i.e. the FINAL pool once every active member has
            // committed their fixed `contribution` — not the partial pool
            // visible while commits are still trickling in. Using the
            // in-flight roundPool() here would understate the cap for
            // early committers and silently defeat the "cap+1 must revert"
            // and "exactly at cap must succeed" cases. Anchor on the
            // maximum possible final pool instead (all joined members'
            // fixed contribution), which is exactly what roundPool() will
            // equal by the time reveal() runs (commit doesn't add bids to
            // the pool, only the fixed `contribution`).
            uint256 pool = actors.length * CONTRIB;
            uint256 cap  = (pool * circle.MAX_BID_DISCOUNT_BPS()) / 10000;

            uint256 pattern = bidSeed % 6;
            if (callCount % 3 == 0) {
                // Forced multi-way tie: fixed bid value independent of seed,
                // driven by the fuzzer's own call sequence.
                amount = cap / 2;
            } else if (pattern == 0) {
                // Exactly at the cap.
                amount = cap;
            } else if (pattern == 1) {
                // One wei over the cap — must revert with BidExceedsCap.
                amount = cap + 1;
            } else if (pattern == 2 || pattern == 3) {
                // Zero bid.
                amount = 0;
            } else {
                // Arbitrary bid within [0, cap] (mixed zero/positive rounds
                // emerge naturally as different actors hit different arms).
                amount = cap == 0 ? 0 : bidSeed % (cap + 1);
            }
            pendingBid[m] = amount;
        } else {
            amount = CONTRIB;
        }

        bytes32 c = keccak256(abi.encodePacked(amount, SALT, m));
        vm.prank(m);
        try circle.commit(c) {} catch {}
    }

    function advanceToReveal() external {
        if (uint256(circle.state()) != uint256(Circle.State.COMMIT)) return;
        try circle.advanceToReveal() {} catch {}
    }

    function reveal(uint256 actorIdx) external {
        if (uint256(circle.state()) != uint256(Circle.State.REVEAL)) return;
        actorIdx = actorIdx % actors.length;
        address m = actors[actorIdx];
        if (!_isJoined(m)) return;
        if (!circle.committed(m)) return;
        if (circle.revealed(m)) return;

        uint256 amount = _isAuction() ? pendingBid[m] : CONTRIB;

        vm.prank(m);
        // NOTE: try/catch swallows reverts (including a deliberately
        // over-cap bid reverting with BidExceedsCap) so a single bad action
        // doesn't kill the whole fuzz run. This is intentional and mirrors
        // the existing pattern used throughout this handler — invalid
        // actions are attempted-and-skipped, not filtered out beforehand,
        // so the revert path is genuinely exercised by the EVM on every run.
        try circle.reveal(amount, SALT) {
            revealSuccessCount++;
        } catch (bytes memory reason) {
            revealRevertCount++;
            if (reason.length >= 4 && bytes4(reason) == Circle.BidExceedsCap.selector) {
                capRevertCount++;
            }
        }
    }

    uint256 public revealSuccessCount;
    uint256 public revealRevertCount;
    uint256 public capRevertCount;

    function slash(uint256 actorIdx) external {
        if (uint256(circle.state()) != uint256(Circle.State.REVEAL)) return;
        actorIdx = actorIdx % actors.length;
        address defaulter = actors[actorIdx];
        if (!_isJoined(defaulter)) return;
        if (circle.revealed(defaulter)) return;
        vm.warp(block.timestamp + circle.REVEAL_WINDOW() + 1);
        try circle.slash(defaulter) {} catch {}
    }

    function requestDraw() external {
        if (uint256(circle.state()) != uint256(Circle.State.DRAW)) return;
        if (circle.drawRequestedAt() != 0) return;
        try circle.requestDraw() {} catch {}
    }

    function fulfillRandomness(uint256 rand) external {
        if (uint256(circle.state()) != uint256(Circle.State.DRAW)) return;
        if (circle.drawRequestedAt() == 0) return;
        try circle.fulfillRandomness(0, rand, "") {} catch {}
    }

    function reclaimOnStall() external {
        if (uint256(circle.state()) != uint256(Circle.State.DRAW)) return;
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
        if (uint256(circle.state()) != uint256(Circle.State.FILLING)) return;
        vm.warp(block.timestamp + circle.FILLING_TIMEOUT() + 1);
        try circle.refundFilling() {} catch {}
    }
}

/// @notice Invariant suite: conservation of value inside Circle.
///         LEAK 3 proof: every token that enters the circle is accounted for
///         in totalClaimable + dustAccrued + undrawnPools.
contract ConservationInvTest is StdInvariant, Test {
    Circle          internal circle;
    MockStable      internal stable;
    CircleHandler   internal handler;

    uint256 constant CONTRIB = 100e6;
    uint256 constant SEATS   = 3;
    uint256 constant BOND    = (SEATS - 1) * CONTRIB;

    function setUp() public {
        stable      = new MockStable();
        address impl = address(new Circle());
        CircleFactory factory = new CircleFactory(impl, address(stable), address(0));
        circle = Circle(factory.createCircle(CONTRIB, SEATS, BOND, Mode.LUCKY_DRAW));

        handler = new CircleHandler(circle, stable);

        targetContract(address(handler));
    }

    function _checkConservation(Circle c) internal view {
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

        assertEq(
            contractBal,
            totalClaims + dust + undrawn + totalBonds,
            "conservation invariant violated"
        );
    }

    /// @notice Conservation invariant:
    ///         contract token balance == totalClaimable + dustAccrued + undrawnPools
    ///
    ///         This holds through every state transition because:
    ///         - join()       : bond enters → stakedBond (tracked in claimable on exit)
    ///         - commit()     : contribution enters → roundPool
    ///         - slash()      : bond redistributed to claimable / roundPool / dustAccrued
    ///         - fulfillRandomness(): roundPool → winner.claimable, bonds → claimable
    ///         - reclaimOnStall() : roundPool → claimable + dustAccrued
    ///         - claim()      : claimable exits → token leaves contract
    ///         Dust is released to first member on COMPLETED.
    function invariant_balanceEqualsClaims() public view {
        _checkConservation(circle);
    }
}

/// @notice AUCTION-mode counterpart of ConservationInvTest. Wires a fresh
///         handler to an AUCTION-mode circle so the fuzzer exercises the
///         dividend-distribution money path (bids, ties, VRF fallback, cap
///         edges) under the same conservation invariant.
contract ConservationInvAuctionTest is StdInvariant, Test {
    Circle          internal circle;
    MockStable      internal stable;
    CircleHandler   internal handler;

    uint256 constant CONTRIB = 100e6;
    uint256 constant SEATS   = 3;
    uint256 constant BOND    = (SEATS - 1) * CONTRIB;

    function setUp() public {
        stable      = new MockStable();
        address impl = address(new Circle());
        CircleFactory factory = new CircleFactory(impl, address(stable), address(0));
        circle = Circle(factory.createCircle(CONTRIB, SEATS, BOND, Mode.AUCTION));

        handler = new CircleHandler(circle, stable);

        targetContract(address(handler));
    }

    function _checkConservation(Circle c) internal view {
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

        assertEq(
            contractBal,
            totalClaims + dust + undrawn + totalBonds,
            "conservation invariant violated"
        );
    }

    /// @notice Conservation invariant under AUCTION mode: bids at/over cap,
    ///         forced ties, zero bids, and the natural eligibleCount == 1
    ///         endgame are all exercised by CircleHandler's mode-aware
    ///         reveal action across the fuzzer's random call sequence.
    function invariant_conservationHoldsAuction() public view {
        _checkConservation(circle);
    }
}
