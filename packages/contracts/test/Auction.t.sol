// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Circle, Mode} from "../src/Circle.sol";
import {CircleFactory} from "../src/CircleFactory.sol";
import {MockStable} from "../src/MockStable.sol";
import {MockEntropy} from "./mocks/MockEntropy.sol";
import {VrfFixture} from "./mocks/VrfFixture.sol";

/// @notice Auction (Mode.AUCTION) round mechanics — sealed-bid discount chit fund.
contract AuctionTest is Test, VrfFixture {
    MockStable    internal stable;
    CircleFactory internal factory;
    MockEntropy internal vrf;

    uint256 internal constant CONTRIB = 100e6;
    uint256 internal constant SEATS   = 3;
    uint256 internal constant BOND    = (SEATS - 1) * CONTRIB;

    address internal alice = address(0xA11CE);
    address internal bob   = address(0xB0B);
    address internal carol = address(0xCA401);

    function setUp() public {
        stable  = new MockStable();
        vrf     = new MockEntropy(VRF_FEE);
        address impl = address(new Circle());
        factory = new CircleFactory(impl, address(stable), address(0), address(vrf));
    }

    function _claimable(Circle circle, address who) internal view returns (uint256 claimable) {
        (, , , claimable) = circle.memberInfo(who);
    }

    function _bond(Circle circle, address who) internal view returns (uint256 stakedBond) {
        (, stakedBond, , ) = circle.memberInfo(who);
    }

    function _fundAndJoin(Circle circle, address who) internal {
        deal(address(stable), who, BOND + CONTRIB * 10);
        vm.prank(who); stable.approve(address(circle), type(uint256).max);
        vm.prank(who); circle.join();
    }

    /// @notice A member who has already won must NOT be auto-committed at the
    ///         start of a later round — they must pay again. Once they commit
    ///         (pay), they are auto-revealed with a forced zero bid.
    function test_pastWinnerMustPayButAutoRevealsOnCommit() public {
        Circle circle = Circle(payable(factory.createCircle{value: VRF_BUDGET}(CONTRIB, SEATS, BOND, Mode.AUCTION)));
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
        vrf.fulfillLatest(address(circle), 42);

        assertEq(uint256(circle.state()), uint256(Circle.State.COMMIT));
        assertEq(circle.currentRound(), 1);

        address r0Winner;
        if (circle.hasWon(alice)) r0Winner = alice;
        else if (circle.hasWon(bob)) r0Winner = bob;
        else r0Winner = carol;

        // Past winner must NOT be auto-committed anymore — they must pay again.
        assertFalse(circle.committed(r0Winner), "winner must commit (pay) each round");
        assertFalse(circle.revealed(r0Winner), "winner not revealed until they commit");
        // After the winner commits (pays), they ARE auto-revealed with bid 0.
        deal(address(stable), r0Winner, CONTRIB);
        vm.prank(r0Winner); stable.approve(address(circle), type(uint256).max);
        vm.prank(r0Winner); circle.commit(keccak256(abi.encodePacked(uint256(0), bytes32("x"), r0Winner)));
        assertTrue(circle.committed(r0Winner), "winner committed after paying");
        assertTrue(circle.revealed(r0Winner), "winner auto-revealed on commit");
        assertEq(circle.bidDiscount(r0Winner), 0, "winner bid forced to 0");
    }

    /// @notice In AUCTION mode, reveal() validates a bid discount (not the
    ///         contribution amount), stores it in bidDiscount[], and rejects
    ///         bids over the 40% cap.
    function test_revealStoresBidAndEnforcesCap() public {
        Circle circle = Circle(payable(factory.createCircle{value: VRF_BUDGET}(CONTRIB, SEATS, BOND, Mode.AUCTION)));
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
        Circle circle = Circle(payable(factory.createCircle{value: VRF_BUDGET}(CONTRIB, SEATS, BOND, Mode.AUCTION)));
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

    /// @notice Full auction round: highest bidder wins the discounted pot,
    ///         and the discount is distributed pro-rata to ALL joined members
    ///         (including the winner), matching real chit-fund dividend rules.
    function test_highestBidderWinsAndDividendDistributed() public {
        Circle circle = Circle(payable(factory.createCircle{value: VRF_BUDGET}(CONTRIB, SEATS, BOND, Mode.AUCTION)));
        _fundAndJoin(circle, alice);
        _fundAndJoin(circle, bob);
        _fundAndJoin(circle, carol);

        bytes32 saltA = "saltA"; bytes32 saltB = "saltB"; bytes32 saltC = "saltC";
        uint256 bidAlice = 30e6;
        uint256 bidBob   = 90e6; // highest, unique
        uint256 bidCarol = 10e6;

        vm.prank(alice); circle.commit(keccak256(abi.encodePacked(bidAlice, saltA, alice)));
        vm.prank(bob);   circle.commit(keccak256(abi.encodePacked(bidBob, saltB, bob)));
        vm.prank(carol); circle.commit(keccak256(abi.encodePacked(bidCarol, saltC, carol)));
        circle.advanceToReveal();
        vm.prank(alice); circle.reveal(bidAlice, saltA);
        vm.prank(bob);   circle.reveal(bidBob, saltB);
        vm.prank(carol); circle.reveal(bidCarol, saltC);

        assertEq(uint256(circle.state()), uint256(Circle.State.DRAW));
        circle.requestDraw();
        vrf.fulfillLatest(address(circle), 999);

        assertTrue(circle.hasWon(bob), "highest unique bidder must win");
        assertFalse(circle.hasWon(alice));
        assertFalse(circle.hasWon(carol));

        assertEq(_claimable(circle, bob), 240e6, "winner gets pot minus discount, plus their own dividend share");
        assertEq(_claimable(circle, alice), 30e6, "alice gets dividend share");
        assertEq(_claimable(circle, carol), 30e6, "carol gets dividend share");
    }

    /// @notice No one places a positive bid (or all bid 0, tied) → falls back
    ///         to a VRF-random draw among eligible members at zero discount.
    function test_noBidsFallsBackToVrfDraw() public {
        Circle circle = Circle(payable(factory.createCircle{value: VRF_BUDGET}(CONTRIB, SEATS, BOND, Mode.AUCTION)));
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

        circle.requestDraw();
        vrf.fulfillLatest(address(circle), 1);

        uint256 wins = (circle.hasWon(alice) ? 1 : 0) + (circle.hasWon(bob) ? 1 : 0) + (circle.hasWon(carol) ? 1 : 0);
        assertEq(wins, 1, "exactly one member should win via VRF tie-break");
    }

    /// @notice A tie at a POSITIVE top bid must restrict the VRF lottery to
    ///         only the tied top bidders — an untied low/zero bidder must
    ///         never be selectable, and the discount credited must be the
    ///         tied topBid amount.
    function test_tiedTopBidRestrictsLotteryToTiedBidders() public {
        Circle circle = Circle(payable(factory.createCircle{value: VRF_BUDGET}(CONTRIB, SEATS, BOND, Mode.AUCTION)));
        _fundAndJoin(circle, alice);
        _fundAndJoin(circle, bob);
        _fundAndJoin(circle, carol);

        bytes32 saltA = "saltA"; bytes32 saltB = "saltB"; bytes32 saltC = "saltC";
        vm.prank(alice); circle.commit(keccak256(abi.encodePacked(uint256(50e6), saltA, alice)));
        vm.prank(bob);   circle.commit(keccak256(abi.encodePacked(uint256(50e6), saltB, bob)));
        vm.prank(carol); circle.commit(keccak256(abi.encodePacked(uint256(10e6), saltC, carol)));
        circle.advanceToReveal();
        vm.prank(alice); circle.reveal(50e6, saltA);
        vm.prank(bob);   circle.reveal(50e6, saltB);
        vm.prank(carol); circle.reveal(10e6, saltC);

        circle.requestDraw();
        vrf.fulfillLatest(address(circle), 3);

        assertFalse(circle.hasWon(carol), "untied lower bidder must never win a tied round");
        bool aliceWon = circle.hasWon(alice);
        bool bobWon   = circle.hasWon(bob);
        assertTrue(aliceWon != bobWon, "exactly one of the tied bidders must win");

        address winner = aliceWon ? alice : bob;
        uint256 sharePerMember = uint256(50e6) / 3;
        assertEq(
            _claimable(circle, winner),
            250e6 + sharePerMember,
            "winner must be credited (pot - TIED bid) plus their own dividend share, not zero discount"
        );
        assertEq(_claimable(circle, carol), sharePerMember, "carol must receive her dividend share of the tied discount");
    }

    /// @notice When only one eligible (non-winner) member remains, they win
    ///         outright regardless of their bid.
    function test_soleRemainingBidderWinsFinalRound() public {
        Circle circle = Circle(payable(factory.createCircle{value: VRF_BUDGET}(CONTRIB, SEATS, BOND, Mode.AUCTION)));
        _fundAndJoin(circle, alice);
        _fundAndJoin(circle, bob);
        _fundAndJoin(circle, carol);

        address[3] memory ppl = [alice, bob, carol];
        for (uint256 round = 0; round < 2; round++) {
            for (uint256 i = 0; i < 3; i++) {
                address who = ppl[i];
                bytes32 salt = bytes32(uint256(round * 10 + i));
                vm.prank(who); circle.commit(keccak256(abi.encodePacked(uint256(0), salt, who)));
            }
            circle.advanceToReveal();
            for (uint256 i = 0; i < 3; i++) {
                address who = ppl[i];
                if (circle.hasWon(who)) continue; // past winners auto-revealed at commit()
                bytes32 salt = bytes32(uint256(round * 10 + i));
                vm.prank(who); circle.reveal(0, salt);
            }
            circle.requestDraw();
            vrf.fulfillLatest(address(circle), uint256(keccak256(abi.encodePacked(round, block.timestamp))));
        }

        address lastBidder;
        uint256 nonWinners = 0;
        for (uint256 i = 0; i < 3; i++) {
            if (!circle.hasWon(ppl[i])) { lastBidder = ppl[i]; nonWinners++; }
        }
        assertEq(nonWinners, 1, "exactly one member should remain before the final round");
        assertEq(uint256(circle.state()), uint256(Circle.State.COMMIT));

        bytes32 saltFinal = "final";
        for (uint256 i = 0; i < 3; i++) {
            address who = ppl[i];
            if (who == lastBidder) continue;
            bytes32 salt = bytes32(uint256(900 + i));
            vm.prank(who); circle.commit(keccak256(abi.encodePacked(uint256(0), salt, who)));
        }
        vm.prank(lastBidder); circle.commit(keccak256(abi.encodePacked(uint256(30e6), saltFinal, lastBidder)));
        circle.advanceToReveal();
        vm.prank(lastBidder); circle.reveal(30e6, saltFinal);

        circle.requestDraw();
        vrf.fulfillLatest(address(circle), 777);

        assertTrue(circle.hasWon(lastBidder), "sole remaining bidder must win outright");
        assertEq(uint256(circle.state()), uint256(Circle.State.COMPLETED));
    }

    /// @notice Full 3-round auction circle: every member wins exactly once,
    ///         circle reaches COMPLETED, bonds returned, balances conserved.
    function test_fullAuctionCycleConservesBalance() public {
        Circle circle = Circle(payable(factory.createCircle{value: VRF_BUDGET}(CONTRIB, SEATS, BOND, Mode.AUCTION)));
        _fundAndJoin(circle, alice);
        _fundAndJoin(circle, bob);
        _fundAndJoin(circle, carol);

        address[3] memory ppl = [alice, bob, carol];
        uint256[3] memory bids = [uint256(10e6), uint256(20e6), uint256(30e6)];

        for (uint256 round = 0; round < SEATS; round++) {
            for (uint256 i = 0; i < 3; i++) {
                address who = ppl[i];
                bytes32 salt = bytes32(uint256(round * 10 + i));
                vm.prank(who); circle.commit(keccak256(abi.encodePacked(bids[i], salt, who)));
            }
            circle.advanceToReveal();
            for (uint256 i = 0; i < 3; i++) {
                address who = ppl[i];
                if (circle.hasWon(who)) continue; // past winners auto-revealed at commit()
                bytes32 salt = bytes32(uint256(round * 10 + i));
                vm.prank(who); circle.reveal(bids[i], salt);
            }
            // Pot must be the FULL pool every round now (winners keep paying).
            assertEq(circle.undrawnPools(), CONTRIB * SEATS, "pot must stay full each round");
            circle.requestDraw();
            vrf.fulfillLatest(address(circle), uint256(keccak256(abi.encodePacked(round))));

            uint256 totalClaimable = _claimable(circle, alice)
                + _claimable(circle, bob)
                + _claimable(circle, carol);
            uint256 totalBonds = _bond(circle, alice)
                + _bond(circle, bob)
                + _bond(circle, carol);
            assertEq(
                stable.balanceOf(address(circle)),
                totalClaimable + circle.dustAccrued() + circle.undrawnPools() + totalBonds,
                "conservation invariant violated mid-auction-cycle"
            );
        }

        assertEq(uint256(circle.state()), uint256(Circle.State.COMPLETED));
        assertTrue(circle.hasWon(alice));
        assertTrue(circle.hasWon(bob));
        assertTrue(circle.hasWon(carol));
    }

    /// @notice Direct regression test for the shrinking-pot bug: with a past
    ///         winner in the circle, the round-1 pot must still be the FULL
    ///         contribution × seats, not contribution × (seats - 1).
    function test_potIsFullEveryRoundWithPastWinners() public {
        Circle circle = Circle(payable(factory.createCircle{value: VRF_BUDGET}(CONTRIB, SEATS, BOND, Mode.AUCTION)));
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
        circle.requestDraw();
        vrf.fulfillLatest(address(circle), 42);

        address[3] memory ppl = [alice, bob, carol];
        for (uint256 i = 0; i < 3; i++) {
            address who = ppl[i];
            bytes32 salt = bytes32(uint256(100 + i));
            vm.prank(who); circle.commit(keccak256(abi.encodePacked(uint256(0), salt, who)));
        }
        circle.advanceToReveal();
        assertEq(circle.undrawnPools(), CONTRIB * SEATS, "pot must be full even with a past winner");
    }

    /// @notice The real-world failing case: a 3x10 circle where round 1's cap
    ///         (40% of the full pool) must accept a 10e6 bid, which previously
    ///         reverted BidExceedsCap because the pot had shrunk.
    function test_round2BidUpTo40PctOfFullPoolAccepted() public {
        uint256 contrib = 10e6;
        uint256 bond = (SEATS - 1) * contrib;
        Circle circle = Circle(payable(factory.createCircle{value: VRF_BUDGET}(contrib, SEATS, bond, Mode.AUCTION)));
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
        circle.requestDraw();
        vrf.fulfillLatest(address(circle), 42);

        address[3] memory ppl = [alice, bob, carol];
        address winner;
        for (uint256 i = 0; i < 3; i++) if (circle.hasWon(ppl[i])) winner = ppl[i];
        address nonWinner = winner == alice ? bob : alice;
        address other = (winner != carol && nonWinner != carol) ? carol : bob;

        for (uint256 i = 0; i < 3; i++) {
            address who = ppl[i];
            bytes32 salt = bytes32(uint256(200 + i));
            uint256 bidAmt = who == nonWinner ? 10e6 : (who == other ? 12e6 : 0);
            vm.prank(who); circle.commit(keccak256(abi.encodePacked(bidAmt, salt, who)));
        }
        circle.advanceToReveal();

        vm.prank(nonWinner);
        circle.reveal(10e6, bytes32(uint256(200 + _idx(ppl, nonWinner))));
        assertEq(circle.bidDiscount(nonWinner), 10e6, "10e6 bid must be accepted against the full pool");

        vm.prank(other);
        circle.reveal(12e6, bytes32(uint256(200 + _idx(ppl, other))));
        assertEq(circle.bidDiscount(other), 12e6, "bid exactly at cap must be accepted");
    }

    function _idx(address[3] memory ppl, address who) internal pure returns (uint256) {
        for (uint256 i = 0; i < 3; i++) if (ppl[i] == who) return i;
        revert("not found");
    }

    /// @notice A round-1 winner who does not commit (pay) is slashable exactly
    ///         like any other defaulting member — their bond is consumed and
    ///         redistributed, and they are removed from the circle.
    function test_winnerWhoDoesNotPayIsSlashable() public {
        Circle circle = Circle(payable(factory.createCircle{value: VRF_BUDGET}(CONTRIB, SEATS, BOND, Mode.AUCTION)));
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
        circle.requestDraw();
        vrf.fulfillLatest(address(circle), 42);

        address[3] memory ppl = [alice, bob, carol];
        address winner;
        for (uint256 i = 0; i < 3; i++) if (circle.hasWon(ppl[i])) winner = ppl[i];

        // Non-winners commit and reveal; winner never commits.
        for (uint256 i = 0; i < 3; i++) {
            address who = ppl[i];
            if (who == winner) continue;
            bytes32 salt = bytes32(uint256(300 + i));
            vm.prank(who); circle.commit(keccak256(abi.encodePacked(uint256(0), salt, who)));
        }
        // Winner did not commit, so advanceToReveal must revert until they do —
        // instead, force the round into REVEAL via slash's own commit-phase
        // handling: slash() requires REVEAL phase timing via roundStart, so we
        // cannot advance to REVEAL without the winner's commit. Advance the
        // clock and slash the winner directly out of COMMIT phase instead.
        vm.warp(block.timestamp + circle.REVEAL_WINDOW() + 1);

        (, uint256 bondBefore,,) = circle.memberInfo(winner);
        assertGt(bondBefore, 0);

        circle.slash(winner);

        (bool joinedAfter,,,) = circle.memberInfo(winner);
        assertFalse(joinedAfter, "non-paying winner should be removed via slash");
    }
}
