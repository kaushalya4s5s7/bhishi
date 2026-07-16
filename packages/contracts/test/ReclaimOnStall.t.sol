// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CircleFactory} from "../src/CircleFactory.sol";
import {Circle, Mode} from "../src/Circle.sol";
import {MockStable} from "../src/MockStable.sol";
import {MockVRF} from "./mocks/MockVRF.sol";

/// @notice Money Shot 4 / LEAK 1 — VRF silence → permissionless reclaim.
contract ReclaimOnStallTest is Test {
    CircleFactory internal factory;
    MockStable internal stable;
    Circle internal circle;
    MockVRF internal vrf;

    uint256 internal constant CONTRIB = 100e6;
    uint256 internal constant SEATS   = 3;
    uint256 internal constant BOND    = 300e6;

    address[] internal addrs;

    function setUp() public {
        stable = new MockStable();
        vrf    = new MockVRF();
        address impl = address(new Circle());
        factory = new CircleFactory(impl, address(stable), address(0));
        circle  = Circle(factory.createCircle(CONTRIB, SEATS, BOND, Mode.LUCKY_DRAW));

        for (uint160 i = 0; i < SEATS; i++) {
            address m = address(uint160(0x3000 + i));
            addrs.push(m);
            deal(address(stable), m, (BOND + CONTRIB) * 10);
            vm.prank(m);
            stable.approve(address(circle), type(uint256).max);
            vm.prank(m);
            circle.join();
        }
        assertEq(uint256(circle.state()), uint256(Circle.State.COMMIT));
    }

    function _commitment(address who, uint256 amount, bytes32 salt) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(amount, salt, who));
    }

    function _commitRevealAll() internal {
        for (uint256 i = 0; i < addrs.length; i++) {
            vm.prank(addrs[i]);
            circle.commit(_commitment(addrs[i], CONTRIB, bytes32(i + 1)));
        }
        circle.advanceToReveal();
        for (uint256 i = 0; i < addrs.length; i++) {
            vm.prank(addrs[i]);
            circle.reveal(CONTRIB, bytes32(i + 1));
        }
        assertEq(uint256(circle.state()), uint256(Circle.State.DRAW));
    }

    // ─── MONEY SHOT 4: reclaimOnStall ─────────────────────────────────────────

    function test_reclaimOnStallAfterVrfTimeout() public {
        _commitRevealAll();
        circle.requestDraw();

        // VRF never responds — warp past VRF_TIMEOUT
        vm.warp(block.timestamp + circle.VRF_TIMEOUT() + 1);

        // Snapshot contract balance before reclaim
        uint256 contractBalBefore = stable.balanceOf(address(circle));

        circle.reclaimOnStall();

        // State must be STALLED
        assertEq(uint256(circle.state()), uint256(Circle.State.STALLED));
        // roundPool zeroed
        assertEq(circle.roundPool(), 0);

        // Each member can claim their share; track total claimed
        uint256 totalClaimed = 0;
        for (uint256 i = 0; i < addrs.length; i++) {
            (,,,uint256 claimable) = circle.memberInfo(addrs[i]);
            assertTrue(claimable > 0, "each joined member should have claimable > 0");

            uint256 balBefore = stable.balanceOf(addrs[i]);
            vm.prank(addrs[i]);
            circle.claim();
            uint256 received = stable.balanceOf(addrs[i]) - balBefore;
            assertEq(received, claimable, "claim() must send exactly claimable amount");
            totalClaimed += received;
        }

        // Conservation: totalClaimed + dustAccrued == contractBalBefore
        uint256 dust = circle.dustAccrued();
        assertEq(totalClaimed + dust, contractBalBefore, "fund conservation violated");

        // Contract balance is now only dust (locked in dustAccrued, not transferred)
        assertEq(stable.balanceOf(address(circle)), dust);
    }

    function test_reclaimBeforeTimeoutReverts() public {
        _commitRevealAll();
        circle.requestDraw();

        // Warp to just before timeout
        vm.warp(block.timestamp + circle.VRF_TIMEOUT() - 1);

        vm.expectRevert();
        circle.reclaimOnStall();
    }

    function test_reclaimWithoutDrawRequestReverts() public {
        _commitRevealAll();
        // requestDraw not called → drawRequestedAt == 0
        vm.expectRevert();
        circle.reclaimOnStall();
    }

    function test_reclaimOnStallRevertsIfNotDrawState() public {
        // Still in COMMIT phase — should revert
        vm.expectRevert();
        circle.reclaimOnStall();
    }

    function test_claimStillWorksAfterStall() public {
        _commitRevealAll();
        circle.requestDraw();
        vm.warp(block.timestamp + circle.VRF_TIMEOUT() + 1);
        circle.reclaimOnStall();

        // claim() must work in STALLED state
        address m = addrs[0];
        (,,,uint256 claimable) = circle.memberInfo(m);
        assertTrue(claimable > 0);
        vm.prank(m);
        circle.claim(); // must not revert
    }
}
