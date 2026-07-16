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

    function commit(uint256 actorIdx) external {
        if (uint256(circle.state()) != uint256(Circle.State.COMMIT)) return;
        actorIdx = actorIdx % actors.length;
        address m = actors[actorIdx];
        if (!_isJoined(m)) return;
        if (circle.committed(m)) return;
        bytes32 c = keccak256(abi.encodePacked(CONTRIB, SALT, m));
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
        vm.prank(m);
        try circle.reveal(CONTRIB, SALT) {} catch {}
    }

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
        uint256 contractBal  = stable.balanceOf(address(circle));
        uint256 totalClaims  = circle.totalClaimable();
        uint256 dust         = circle.dustAccrued();
        uint256 undrawn      = circle.undrawnPools();

        // Also account for staked bonds not yet returned (pre-COMPLETED)
        uint256 totalBonds = 0;
        uint256 n = circle.memberCount();
        for (uint256 i = 0; i < n; i++) {
            address m = circle.members(i);
            (bool joined, uint256 stakedBond,,) = circle.memberInfo(m);
            if (joined) totalBonds += stakedBond;
        }

        assertEq(
            contractBal,
            totalClaims + dust + undrawn + totalBonds,
            "conservation invariant violated"
        );
    }
}
