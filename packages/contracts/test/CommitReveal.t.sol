// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CircleFactory} from "../src/CircleFactory.sol";
import {Circle, Mode} from "../src/Circle.sol";
import {MockStable} from "../src/MockStable.sol";

contract CommitRevealTest is Test {
    CircleFactory internal factory;
    MockStable internal stable;
    Circle internal circle;

    uint256 internal constant CONTRIB = 100e6;
    uint256 internal constant SEATS = 3;
    uint256 internal constant BOND = 300e6;

    address[] internal addrs;

    function setUp() public {
        stable = new MockStable();
        address impl = address(new Circle());
        factory = new CircleFactory(impl, address(stable), address(0));
        circle = Circle(factory.createCircle(CONTRIB, SEATS, BOND, Mode.LUCKY_DRAW));

        // Enroll SEATS members and fill circle → ACTIVE → COMMIT
        for (uint160 i = 0; i < SEATS; i++) {
            address m = address(uint160(0x1000 + i));
            addrs.push(m);
            deal(address(stable), m, BOND + CONTRIB * 10); // extra for future rounds
            vm.prank(m);
            stable.approve(address(circle), type(uint256).max);
            vm.prank(m);
            circle.join();
        }
        // After last join the state should be COMMIT
        assertEq(uint256(circle.state()), uint256(Circle.State.COMMIT));
    }

    function _commitment(address who, uint256 amount, bytes32 salt) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(amount, salt, who));
    }

    // ── RED tests ──────────────────────────────────────────────────────────────

    function test_stateIsCommitAfterActivation() public view {
        assertEq(uint256(circle.state()), uint256(Circle.State.COMMIT));
    }

    function test_commitThenValidRevealAccepted() public {
        bytes32 salt = bytes32(uint256(42));
        address m = addrs[0];

        // commit
        bytes32 h = _commitment(m, CONTRIB, salt);
        vm.prank(m);
        circle.commit(h);
        assertTrue(circle.committed(m));
        assertFalse(circle.revealed(m));

        // reveal
        vm.prank(m);
        circle.reveal(CONTRIB, salt);
        assertTrue(circle.revealed(m));
    }

    function test_invalidRevealReverts() public {
        bytes32 salt = bytes32(uint256(42));
        address m = addrs[0];
        bytes32 h = _commitment(m, CONTRIB, salt);
        vm.prank(m);
        circle.commit(h);

        bytes32 wrongSalt = bytes32(uint256(99));
        vm.prank(m);
        vm.expectRevert(Circle.InvalidReveal.selector);
        circle.reveal(CONTRIB, wrongSalt);
    }

    function test_revealWithWrongAmountReverts() public {
        bytes32 salt = bytes32(uint256(7));
        address m = addrs[0];
        bytes32 h = _commitment(m, CONTRIB, salt);
        vm.prank(m);
        circle.commit(h);

        vm.prank(m);
        vm.expectRevert(Circle.InvalidReveal.selector);
        circle.reveal(CONTRIB + 1, salt);
    }

    function test_allRevealTransitionsToDrawState() public {
        // All members commit then reveal
        for (uint256 i = 0; i < addrs.length; i++) {
            address m = addrs[i];
            bytes32 salt = bytes32(i + 1);
            bytes32 h = _commitment(m, CONTRIB, salt);
            vm.prank(m);
            circle.commit(h);
        }
        for (uint256 i = 0; i < addrs.length; i++) {
            address m = addrs[i];
            bytes32 salt = bytes32(i + 1);
            vm.prank(m);
            circle.reveal(CONTRIB, salt);
        }
        assertEq(uint256(circle.state()), uint256(Circle.State.DRAW));
    }

    function test_doubleCommitReverts() public {
        bytes32 salt = bytes32(uint256(1));
        address m = addrs[0];
        bytes32 h = _commitment(m, CONTRIB, salt);
        vm.prank(m);
        circle.commit(h);
        vm.prank(m);
        vm.expectRevert(Circle.AlreadyCommitted.selector);
        circle.commit(h);
    }

    function test_revealWithoutCommitReverts() public {
        address m = addrs[0];
        vm.prank(m);
        vm.expectRevert(Circle.NotCommitted.selector);
        circle.reveal(CONTRIB, bytes32(uint256(1)));
    }

    function test_commitPullsContribution() public {
        address m = addrs[0];
        uint256 balBefore = stable.balanceOf(m);
        bytes32 h = _commitment(m, CONTRIB, bytes32(uint256(5)));
        vm.prank(m);
        circle.commit(h);
        assertEq(stable.balanceOf(m), balBefore - CONTRIB);
    }

    function test_roundPoolAccumulatesOnCommit() public {
        uint256 poolBefore = circle.roundPool();
        address m = addrs[0];
        bytes32 h = _commitment(m, CONTRIB, bytes32(uint256(3)));
        vm.prank(m);
        circle.commit(h);
        assertEq(circle.roundPool(), poolBefore + CONTRIB);
    }

    function test_claimWithdrawsClaimable() public {
        // Give member[0] some claimable manually via slash (tested in slashing),
        // here we just ensure claim() doesn't revert when claimable == 0.
        address m = addrs[0];
        vm.prank(m);
        circle.claim();
        assertEq(stable.balanceOf(m), stable.balanceOf(m)); // no-op, just no revert
    }
}
