// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Circle, Mode} from "../src/Circle.sol";
import {CircleFactory} from "../src/CircleFactory.sol";
import {MockStable} from "../src/MockStable.sol";

/// @notice Verifies the slash() FSM fix: slashing the last non-revealer
///         must automatically advance state to DRAW rather than leaving
///         the circle permanently stuck in REVEAL.
contract SlashFSMTest is Test {
    MockStable    internal stable;
    CircleFactory internal factory;

    uint256 internal constant CONTRIB = 100e6;
    uint256 internal constant SEATS   = 2;
    uint256 internal constant BOND    = (SEATS - 1) * CONTRIB; // 100e6

    bytes32 constant SALT = bytes32(uint256(0xF00D));

    function setUp() public {
        stable  = new MockStable();
        address impl = address(new Circle());
        factory = new CircleFactory(impl, address(stable), address(0));
    }

    /// @notice 2-member circle: alice reveals, bob commits but misses reveal.
    ///         After slash(bob), state must be DRAW — not stuck in REVEAL.
    function test_slashLastNonRevealerAdvancesToDraw() public {
        Circle circle = Circle(factory.createCircle(CONTRIB, SEATS, BOND, Mode.LUCKY_DRAW));

        address alice = address(0xA11CE);
        address bob   = address(0xB0B);

        deal(address(stable), alice, BOND + CONTRIB * 10);
        deal(address(stable), bob,   BOND + CONTRIB * 10);
        vm.prank(alice); stable.approve(address(circle), type(uint256).max);
        vm.prank(bob);   stable.approve(address(circle), type(uint256).max);
        vm.prank(alice); circle.join();
        vm.prank(bob);   circle.join();

        assertEq(uint256(circle.state()), uint256(Circle.State.COMMIT));

        // Both commit
        vm.prank(alice); circle.commit(keccak256(abi.encodePacked(CONTRIB, SALT, alice)));
        vm.prank(bob);   circle.commit(keccak256(abi.encodePacked(CONTRIB, SALT, bob)));
        circle.advanceToReveal();
        assertEq(uint256(circle.state()), uint256(Circle.State.REVEAL));

        // Alice reveals; bob does NOT
        vm.prank(alice); circle.reveal(CONTRIB, SALT);
        // State is still REVEAL because bob hasn't revealed yet
        assertEq(uint256(circle.state()), uint256(Circle.State.REVEAL));

        // Warp past reveal deadline and slash bob
        vm.warp(block.timestamp + circle.REVEAL_WINDOW() + 1);
        circle.slash(bob);

        // FSM fix: bob was the last non-revealer, so state must advance to DRAW
        assertEq(
            uint256(circle.state()),
            uint256(Circle.State.DRAW),
            "circle stuck in REVEAL after slashing last non-revealer"
        );
    }

    /// @notice Complementary: AUCTION mode is rejected at initialization.
    function test_auctionModeRevertsOnCreate() public {
        vm.expectRevert(Circle.AuctionNotImplemented.selector);
        factory.createCircle(CONTRIB, SEATS, BOND, Mode.AUCTION);
    }
}
