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
        assertEq(uint256(circle.state()), uint256(Circle.State.COMMIT));
    }

    function _commitment(address who, uint256 amount, bytes32 salt) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(amount, salt, who));
    }

    /// Commit all 3, advance to REVEAL, have addrs[0..1] reveal, warp past deadline.
    /// addrs[2] is the defaulter (does not reveal).
    function _setupForSlash() internal {
        for (uint256 i = 0; i < addrs.length; i++) {
            vm.prank(addrs[i]);
            circle.commit(_commitment(addrs[i], CONTRIB, bytes32(i + 1)));
        }
        // advanceToReveal resets roundStart → slash timer runs from here
        circle.advanceToReveal();
        assertEq(uint256(circle.state()), uint256(Circle.State.REVEAL));

        vm.prank(addrs[0]);
        circle.reveal(CONTRIB, bytes32(uint256(1)));
        vm.prank(addrs[1]);
        circle.reveal(CONTRIB, bytes32(uint256(2)));

        vm.warp(block.timestamp + circle.REVEAL_WINDOW() + 1);
    }

    // ─── MONEY SHOT 3 ────────────────────────────────────────────────────────────

    function test_missedRevealIsSlashed_winnerMadeWhole() public {
        _setupForSlash();

        address defaulter = addrs[2];
        (, uint256 bondBefore,,) = circle.memberInfo(defaulter);

        circle.slash(defaulter);

        (bool joinedAfter,,,) = circle.memberInfo(defaulter);
        assertFalse(joinedAfter, "defaulter should be removed");

        // All 3 committed so pool already has 3*CONTRIB; slash doesn't top up further
        assertGe(circle.roundPool(), SEATS * CONTRIB, "pool should cover all contributions");

        // Bond remainder distributed pro-rata to 2 compliant (revealed) members
        uint256 sharePerMember = bondBefore / 2;
        if (sharePerMember > 0) {
            (,,, uint256 c0) = circle.memberInfo(addrs[0]);
            (,,, uint256 c1) = circle.memberInfo(addrs[1]);
            assertGe(c0, sharePerMember, "member0 should receive bond share");
            assertGe(c1, sharePerMember, "member1 should receive bond share");
        }
    }

    /// @notice LEAK 3: integer remainder from bond redistribution goes to dustAccrued.
    function test_slashRemainderGoesToDustBucket() public {
        // bond=301e6+1: remainder after slash = 301_000_001; 301_000_001/2=150_500_000 r1 → dust=1
        MockStable stab2 = new MockStable();
        address impl2 = address(new Circle());
        CircleFactory factory2 = new CircleFactory(impl2, address(stab2), address(0));
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

        for (uint256 i = 0; i < SEATS; i++) {
            vm.prank(members2[i]);
            c2.commit(_commitment(members2[i], CONTRIB, bytes32(i + 100)));
        }

        c2.advanceToReveal();

        vm.prank(members2[0]);
        c2.reveal(CONTRIB, bytes32(uint256(100)));
        vm.prank(members2[1]);
        c2.reveal(CONTRIB, bytes32(uint256(101)));

        vm.warp(block.timestamp + c2.REVEAL_WINDOW() + 1);

        uint256 dustBefore = c2.dustAccrued();
        c2.slash(members2[2]);

        assertEq(c2.dustAccrued(), dustBefore + 1, "dust bucket should capture integer remainder");
    }

    function test_slashBeforeDeadlineReverts() public {
        for (uint256 i = 0; i < addrs.length; i++) {
            vm.prank(addrs[i]);
            circle.commit(_commitment(addrs[i], CONTRIB, bytes32(i + 1)));
        }
        circle.advanceToReveal();
        // Do NOT warp — still within reveal window

        vm.expectRevert(Circle.RevealWindowOpen.selector);
        circle.slash(addrs[0]);
    }

    function test_slashNonMemberReverts() public {
        for (uint256 i = 0; i < addrs.length; i++) {
            vm.prank(addrs[i]);
            circle.commit(_commitment(addrs[i], CONTRIB, bytes32(i + 1)));
        }
        circle.advanceToReveal();
        vm.warp(block.timestamp + circle.REVEAL_WINDOW() + 1);

        vm.expectRevert(Circle.NotMember.selector);
        circle.slash(address(0xDEAD));
    }

    function test_slashAlreadyRevealedReverts() public {
        for (uint256 i = 0; i < addrs.length; i++) {
            vm.prank(addrs[i]);
            circle.commit(_commitment(addrs[i], CONTRIB, bytes32(i + 1)));
        }
        circle.advanceToReveal();

        vm.prank(addrs[0]);
        circle.reveal(CONTRIB, bytes32(uint256(1)));

        vm.warp(block.timestamp + circle.REVEAL_WINDOW() + 1);

        vm.expectRevert(Circle.AlreadyRevealed.selector);
        circle.slash(addrs[0]);
    }

    function test_claimPaysOutClaimable() public {
        _setupForSlash();
        circle.slash(addrs[2]);

        address beneficiary = addrs[0];
        (,,, uint256 claimable) = circle.memberInfo(beneficiary);
        assertGt(claimable, 0, "claimable should be nonzero after slash");

        uint256 balBefore = stable.balanceOf(beneficiary);
        vm.prank(beneficiary);
        circle.claim();
        assertEq(stable.balanceOf(beneficiary), balBefore + claimable);
        (,,, uint256 claimableAfter) = circle.memberInfo(beneficiary);
        assertEq(claimableAfter, 0, "claimable should be 0 after claim");
    }
}
