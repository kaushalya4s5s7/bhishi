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

        assertEq(uint256(circle.state()), uint256(Circle.State.COMMIT));
        assertEq(circle.currentRound(), 1);

        address r0Winner;
        if (circle.hasWon(alice)) r0Winner = alice;
        else if (circle.hasWon(bob)) r0Winner = bob;
        else r0Winner = carol;

        assertTrue(circle.committed(r0Winner), "past winner should be auto-committed");
        assertTrue(circle.revealed(r0Winner), "past winner should be auto-revealed");
        assertEq(circle.bidDiscount(r0Winner), 0, "past winner's auto-bid must be zero");
    }

    /// @notice In AUCTION mode, reveal() validates a bid discount (not the
    ///         contribution amount), stores it in bidDiscount[], and rejects
    ///         bids over the 40% cap.
    function test_revealStoresBidAndEnforcesCap() public {
        Circle circle = Circle(factory.createCircle(CONTRIB, SEATS, BOND, Mode.AUCTION));
        _fundAndJoin(circle, alice);
        _fundAndJoin(circle, bob);
        _fundAndJoin(circle, carol);

        bytes32 saltA = "saltA"; bytes32 saltB = "saltB"; bytes32 saltC = "saltC";
        uint256 bidAlice = 50e6;
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
    function test_bidAtCapAccepted_overCapReverts() public {
        Circle circle = Circle(factory.createCircle(CONTRIB, SEATS, BOND, Mode.AUCTION));
        _fundAndJoin(circle, alice);
        _fundAndJoin(circle, bob);
        _fundAndJoin(circle, carol);

        bytes32 saltA = "saltA"; bytes32 saltB = "saltB"; bytes32 saltC = "saltC";
        vm.prank(alice); circle.commit(keccak256(abi.encodePacked(uint256(120e6), saltA, alice)));
        vm.prank(bob);   circle.commit(keccak256(abi.encodePacked(uint256(120e6 + 1), saltB, bob)));
        vm.prank(carol); circle.commit(keccak256(abi.encodePacked(uint256(0), saltC, carol)));
        circle.advanceToReveal();

        vm.prank(alice); circle.reveal(120e6, saltA);
        assertEq(circle.bidDiscount(alice), 120e6);

        vm.prank(bob);
        vm.expectRevert(Circle.BidExceedsCap.selector);
        circle.reveal(120e6 + 1, saltB);
    }
}
