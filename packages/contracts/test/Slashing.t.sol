// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CircleFactory} from "../src/CircleFactory.sol";
import {Circle, Mode} from "../src/Circle.sol";
import {MockStable} from "../src/MockStable.sol";

/// @notice Money-shot 3: default → slash → winner made whole + dust bucket.
contract SlashingTest is Test {
    MockStable internal stable;
    Circle internal circle;

    uint256 internal constant CONTRIB = 100e6;
    uint256 internal constant SEATS = 3;
    uint256 internal constant BOND = 300e6;

    address[] internal addrs;

    function setUp() public {
        stable = new MockStable();
        address impl = address(new Circle());
        CircleFactory factory = new CircleFactory(impl, address(stable), address(0));
        circle = Circle(factory.createCircle(CONTRIB, SEATS, BOND, Mode.LUCKY_DRAW));

        for (uint160 i = 0; i < SEATS; i++) {
            address m = address(uint160(0x2000 + i));
            addrs.push(m);
            deal(address(stable), m, BOND + CONTRIB * 10);
            vm.prank(m);
            stable.approve(address(circle), type(uint256).max);
            vm.prank(m);
            circle.join();
        }
        // State should be COMMIT after the last join
        assertEq(uint256(circle.state()), uint256(Circle.State.COMMIT));
    }

    function _commitment(address who, uint256 amount, bytes32 salt) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(amount, salt, who));
    }

    // ── MONEY SHOT 3 ────────────────────────────────────────────────────────────

    /// @notice N members commit; 1 skips reveal past deadline → slash() works.
    ///         - defaulter.bond tops up pool so pool == N*contribution
    ///         - remainder of bond redistributed pro-rata to compliant members
    ///         - defaulter marked removed
    function test_missedRevealIsSlashed_winnerMadeWhole() public {
        // All 3 commit
        for (uint256 i = 0; i < addrs.length; i++) {
            address m = addrs[i];
            bytes32 h = _commitment(m, CONTRIB, bytes32(i + 1));
            vm.prank(m);
            circle.commit(h);
        }

        // addrs[0] and addrs[1] reveal; addrs[2] skips
        for (uint256 i = 0; i < 2; i++) {
            address m = addrs[i];
            vm.prank(m);
            circle.reveal(CONTRIB, bytes32(i + 1));
        }

        // Warp past reveal deadline
        vm.warp(block.timestamp + circle.REVEAL_WINDOW() + 1);

        address defaulter = addrs[2];
        (, uint256 bondBefore,,) = circle.memberInfo(defaulter);

        // Slash the defaulter
        circle.slash(defaulter);

        // Defaulter must be marked removed
        (bool joinedAfter,,,) = circle.memberInfo(defaulter);
        assertFalse(joinedAfter, "defaulter should be removed");

        // Round pool should cover full N*contribution now
        // (committed contributions from 2 members + defaulter contribution from bond)
        uint256 expectedPool = SEATS * CONTRIB;
        assertGe(circle.roundPool(), expectedPool, "pool should cover all contributions");

        // Compliant members claimable should have increased (bond remainder distributed)
        uint256 totalBondRemainder = bondBefore; // defaulter committed so contribution already in pool
        // pro-rata for 2 compliant members
        uint256 sharePerMember = totalBondRemainder / 2;
        if (sharePerMember > 0) {
            (,,, uint256 claimable0) = circle.memberInfo(addrs[0]);
            (,,, uint256 claimable1) = circle.memberInfo(addrs[1]);
            assertGe(claimable0, sharePerMember, "member0 should receive bond share");
            assertGe(claimable1, sharePerMember, "member1 should receive bond share");
        }
    }

    /// @notice LEAK 3: integer remainder from bond redistribution goes to dustAccrued.
    function test_slashRemainderGoesToDustBucket() public {
        // Use 3 members so bond remainder = 300e6 - 0 (defaulter committed) = 300e6
        // 300e6 / 2 compliant = 150e6 each, remainder = 0 for this config.
        // Use odd BOND to force dust: we'll use a circle with bond=301e6.
        // Actually: create a new circle with bond that produces dust.
        MockStable stab2 = new MockStable();
        address impl2 = address(new Circle());
        CircleFactory factory2 = new CircleFactory(impl2, address(stab2), address(0));
        // bond=301e6+1, seats=3, defaulter committed so remainder = 301e6+1 → (301e6+1)/2 = 150_500_000 r1 → dust=1
        uint256 dustBond = 301e6 + 1;
        Circle c2 = Circle(factory2.createCircle(CONTRIB, SEATS, dustBond, Mode.LUCKY_DRAW));

        address[] memory members2 = new address[](SEATS);
        for (uint160 i = 0; i < SEATS; i++) {
            address m = address(uint160(0x3000 + i));
            members2[i] = m;
            deal(address(stab2), m, dustBond + CONTRIB * 10);
            vm.prank(m);
            stab2.approve(address(c2), type(uint256).max);
            vm.prank(m);
            c2.join();
        }

        // All 3 commit (contribution pulled from each)
        for (uint256 i = 0; i < SEATS; i++) {
            address m = members2[i];
            bytes32 h = _commitment(m, CONTRIB, bytes32(i + 100));
            vm.prank(m);
            c2.commit(h);
        }

        // members2[0] and members2[1] reveal
        for (uint256 i = 0; i < 2; i++) {
            vm.prank(members2[i]);
            c2.reveal(CONTRIB, bytes32(i + 100));
        }

        // Warp past reveal window
        vm.warp(block.timestamp + c2.REVEAL_WINDOW() + 1);

        uint256 dustBefore = c2.dustAccrued();

        // Slash defaulter (members2[2]) who committed but didn't reveal
        c2.slash(members2[2]);

        uint256 dustAfter = c2.dustAccrued();
        // dust should have increased by 1 (301e6 / 2 = 150e6 each, remainder 1)
        assertEq(dustAfter, dustBefore + 1, "dust bucket should capture integer remainder");
    }

    function test_slashBeforeDeadlineReverts() public {
        // All commit, no reveals, try to slash before window expires
        for (uint256 i = 0; i < addrs.length; i++) {
            address m = addrs[i];
            vm.prank(m);
            circle.commit(_commitment(m, CONTRIB, bytes32(i + 1)));
        }

        vm.expectRevert(Circle.RevealWindowOpen.selector);
        circle.slash(addrs[0]);
    }

    function test_slashNonMemberReverts() public {
        vm.warp(block.timestamp + circle.REVEAL_WINDOW() + 1);
        vm.expectRevert(Circle.NotMember.selector);
        circle.slash(address(0xDEAD));
    }

    function test_slashAlreadyRevealedReverts() public {
        // Commit + reveal, then try to slash
        for (uint256 i = 0; i < addrs.length; i++) {
            address m = addrs[i];
            vm.prank(m);
            circle.commit(_commitment(m, CONTRIB, bytes32(i + 1)));
        }
        vm.prank(addrs[0]);
        circle.reveal(CONTRIB, bytes32(uint256(1)));

        vm.warp(block.timestamp + circle.REVEAL_WINDOW() + 1);

        vm.expectRevert(Circle.AlreadyRevealed.selector);
        circle.slash(addrs[0]);
    }

    function test_claimPaysOutClaimable() public {
        // Set up a slash scenario so claimable is non-zero
        for (uint256 i = 0; i < addrs.length; i++) {
            address m = addrs[i];
            vm.prank(m);
            circle.commit(_commitment(m, CONTRIB, bytes32(i + 1)));
        }
        for (uint256 i = 0; i < 2; i++) {
            vm.prank(addrs[i]);
            circle.reveal(CONTRIB, bytes32(i + 1));
        }
        vm.warp(block.timestamp + circle.REVEAL_WINDOW() + 1);
        circle.slash(addrs[2]);

        address beneficiary = addrs[0];
        (,,, uint256 claimable) = circle.memberInfo(beneficiary);
        assertGt(claimable, 0, "claimable should be nonzero after slash");

        uint256 balBefore = stable.balanceOf(beneficiary);
        vm.prank(beneficiary);
        circle.claim();
        assertEq(stable.balanceOf(beneficiary), balBefore + claimable, "claim should transfer claimable");
        (,,, uint256 claimableAfter) = circle.memberInfo(beneficiary);
        assertEq(claimableAfter, 0, "claimable should be 0 after claim");
    }
}
