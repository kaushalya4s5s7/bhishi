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

        for (uint160 i = 0; i < SEATS; i++) {
            address m = address(uint160(0x1000 + i));
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

    /// Commit all members and advance to REVEAL phase.
    function _commitAll() internal {
        for (uint256 i = 0; i < addrs.length; i++) {
            address m = addrs[i];
            vm.prank(m);
            circle.commit(_commitment(m, CONTRIB, bytes32(i + 1)));
        }
        circle.advanceToReveal();
        assertEq(uint256(circle.state()), uint256(Circle.State.REVEAL));
    }

    // ─── tests ────────────────────────────────────────────────────────────────

    function test_stateIsCommitAfterActivation() public view {
        assertEq(uint256(circle.state()), uint256(Circle.State.COMMIT));
    }

    function test_commitThenValidRevealAccepted() public {
        // All members must commit before we can advance to REVEAL
        _commitAll();

        address m = addrs[0];
        bytes32 salt = bytes32(uint256(1)); // matches salt used in _commitAll
        assertTrue(circle.committed(m));
        assertFalse(circle.revealed(m));

        vm.prank(m);
        circle.reveal(CONTRIB, salt);
        assertTrue(circle.revealed(m));
    }

    function test_invalidRevealReverts() public {
        _commitAll();

        address m = addrs[0];
        bytes32 wrongSalt = bytes32(uint256(99));
        vm.prank(m);
        vm.expectRevert(Circle.InvalidReveal.selector);
        circle.reveal(CONTRIB, wrongSalt);
    }

    function test_revealWithWrongAmountReverts() public {
        _commitAll();

        address m = addrs[0];
        bytes32 correctSalt = bytes32(uint256(1));
        vm.prank(m);
        vm.expectRevert(Circle.InvalidReveal.selector);
        circle.reveal(CONTRIB + 1, correctSalt);
    }

    function test_allRevealTransitionsToDrawState() public {
        _commitAll();

        for (uint256 i = 0; i < addrs.length; i++) {
            vm.prank(addrs[i]);
            circle.reveal(CONTRIB, bytes32(i + 1));
        }
        assertEq(uint256(circle.state()), uint256(Circle.State.DRAW));
    }

    function test_doubleCommitReverts() public {
        address m = addrs[0];
        bytes32 h = _commitment(m, CONTRIB, bytes32(uint256(1)));
        vm.prank(m);
        circle.commit(h);
        vm.prank(m);
        vm.expectRevert(Circle.AlreadyCommitted.selector);
        circle.commit(h);
    }

    function test_revealWithoutCommitReverts() public {
        // State is still COMMIT, so reveal() reverts with NotRevealPhase
        address m = addrs[0];
        vm.prank(m);
        vm.expectRevert(Circle.NotRevealPhase.selector);
        circle.reveal(CONTRIB, bytes32(uint256(1)));
    }

    function test_commitPullsContribution() public {
        address m = addrs[0];
        uint256 balBefore = stable.balanceOf(m);
        vm.prank(m);
        circle.commit(_commitment(m, CONTRIB, bytes32(uint256(5))));
        assertEq(stable.balanceOf(m), balBefore - CONTRIB);
    }

    function test_roundPoolAccumulatesOnCommit() public {
        uint256 poolBefore = circle.roundPool();
        address m = addrs[0];
        vm.prank(m);
        circle.commit(_commitment(m, CONTRIB, bytes32(uint256(3))));
        assertEq(circle.roundPool(), poolBefore + CONTRIB);
    }

    function test_advanceToRevealRevertsIfNotAllCommitted() public {
        // Only one member committed — advanceToReveal should revert
        vm.prank(addrs[0]);
        circle.commit(_commitment(addrs[0], CONTRIB, bytes32(uint256(1))));
        vm.expectRevert(Circle.CommitPhaseNotComplete.selector);
        circle.advanceToReveal();
    }

    function test_advanceToRevealSucceedsWhenAllCommitted() public {
        for (uint256 i = 0; i < addrs.length; i++) {
            vm.prank(addrs[i]);
            circle.commit(_commitment(addrs[i], CONTRIB, bytes32(i + 1)));
        }
        circle.advanceToReveal();
        assertEq(uint256(circle.state()), uint256(Circle.State.REVEAL));
    }

    function test_claimRevertsWhenNothingToClaim() public {
        address m = addrs[0];
        vm.prank(m);
        vm.expectRevert(Circle.NothingToClaim.selector);
        circle.claim();
    }
}
