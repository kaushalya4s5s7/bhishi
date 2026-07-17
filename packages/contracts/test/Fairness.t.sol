// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CircleFactory} from "../src/CircleFactory.sol";
import {Circle, Mode} from "../src/Circle.sol";
import {MockStable} from "../src/MockStable.sol";
import {MockEntropy} from "./mocks/MockEntropy.sol";
import {VrfFixture} from "./mocks/VrfFixture.sol";

contract FairnessTest is Test, VrfFixture {
    CircleFactory internal factory;
    MockStable internal stable;
    Circle internal circle;
    MockEntropy internal vrf;

    uint256 internal constant CONTRIB = 100e6;
    uint256 internal constant SEATS   = 3;
    uint256 internal constant BOND    = 300e6;

    address[] internal addrs;

    function setUp() public {
        stable = new MockStable();
        vrf    = new MockEntropy(VRF_FEE);
        address impl = address(new Circle());
        factory = new CircleFactory(impl, address(stable), address(0), address(vrf));
        circle  = Circle(payable(factory.createCircle{value: VRF_BUDGET}(CONTRIB, SEATS, BOND, Mode.LUCKY_DRAW)));

        for (uint160 i = 0; i < SEATS; i++) {
            address m = address(uint160(0x2000 + i));
            addrs.push(m);
            deal(address(stable), m, (BOND + CONTRIB) * 20);
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

    /// Commit + reveal all members → state == DRAW
    function _commitRevealAll(uint256 saltBase) internal {
        for (uint256 i = 0; i < addrs.length; i++) {
            vm.prank(addrs[i]);
            circle.commit(_commitment(addrs[i], CONTRIB, bytes32(saltBase + i + 1)));
        }
        circle.advanceToReveal();
        for (uint256 i = 0; i < addrs.length; i++) {
            vm.prank(addrs[i]);
            circle.reveal(CONTRIB, bytes32(saltBase + i + 1));
        }
        // state should now be DRAW
    }

    // ─── Money Shot 2: Fairness ────────────────────────────────────────────────

    /// Only fulfillRandomness sets hasWon — no other path can mark a winner.
    function test_winnerSetOnlyByVrfFulfil() public {
        _commitRevealAll(100);
        assertEq(uint256(circle.state()), uint256(Circle.State.DRAW));

        // Before VRF, nobody has won
        for (uint256 i = 0; i < addrs.length; i++) {
            assertFalse(circle.hasWon(addrs[i]));
        }

        circle.requestDraw();
        vrf.fulfillLatest(address(circle), uint256(keccak256("seed1")));

        // Exactly one member should now have hasWon == true
        uint256 winnerCount = 0;
        for (uint256 i = 0; i < addrs.length; i++) {
            if (circle.hasWon(addrs[i])) winnerCount++;
        }
        assertEq(winnerCount, 1);
    }

    /// There is no organizer-controlled function that can set the winner.
    function test_organizerCannotInfluenceWinner() public {
        // Circle has no selectWinner / forceWinner function — any call to a
        // non-existent selector must revert (low-level call returns false).
        bytes memory data = abi.encodeWithSignature("selectWinner(address)", addrs[0]);
        (bool ok,) = address(circle).call(data);
        assertFalse(ok, "organizer can't influence winner via selectWinner");
    }

    /// Over N rounds (SEATS rounds = full cycle), each member wins exactly once.
    function test_winnerExcludesPriorWinners() public {
        // We need deterministic seeds that land on each member exactly once.
        // With 3 members eligible, randomness % eligible.length picks the index.
        // Round 0: 3 eligible → seed % 3 = 0 → addrs[0] wins
        // Round 1: 2 eligible → seed % 2 = 1 → the second of remaining wins
        // Round 2: 1 eligible → seed % 1 = 0 → last member wins
        uint256[3] memory seeds = [uint256(3), uint256(4), uint256(7)];
        // seed % eligible: round0: 3%3=0, round1: 4%2=0, round2: 7%1=0
        // all land at index 0 of remaining eligible each round

        address[] memory winners = new address[](SEATS);
        uint256 saltBase = 0;

        for (uint256 r = 0; r < SEATS; r++) {
            assertEq(uint256(circle.state()), uint256(Circle.State.COMMIT),
                "should be in COMMIT at start of each round");

            _commitRevealAll(saltBase);
            saltBase += 100;

            assertEq(uint256(circle.state()), uint256(Circle.State.DRAW));
            circle.requestDraw();
            vrf.fulfillLatest(address(circle), seeds[r]);

            // Record winner of this round
            address roundWinner;
            for (uint256 i = 0; i < addrs.length; i++) {
                if (circle.hasWon(addrs[i])) {
                    bool alreadyRecorded = false;
                    for (uint256 j = 0; j < r; j++) {
                        if (winners[j] == addrs[i]) { alreadyRecorded = true; break; }
                    }
                    if (!alreadyRecorded) {
                        roundWinner = addrs[i];
                    }
                }
            }
            winners[r] = roundWinner;

            if (r < SEATS - 1) {
                // Should have advanced to next COMMIT round
                assertEq(uint256(circle.state()), uint256(Circle.State.COMMIT),
                    "should advance to COMMIT after non-final round");
            }
        }

        // All winners are distinct
        for (uint256 i = 0; i < SEATS; i++) {
            for (uint256 j = i + 1; j < SEATS; j++) {
                assertTrue(winners[i] != winners[j], "duplicate winner detected");
            }
        }

        // Final state should be COMPLETED
        assertEq(uint256(circle.state()), uint256(Circle.State.COMPLETED));
    }

    /// If all members have hasWon==true (e.g. slashed/removed mid-cycle edge case),
    /// fulfillRandomness should transition to STALLED rather than panic on mod-by-zero.
    function test_fulfillRandomnessWithNoEligibleMembersStalls() public {
        _commitRevealAll(200);
        assertEq(uint256(circle.state()), uint256(Circle.State.DRAW));
        circle.requestDraw();

        // Force hasWon = true for all members via vm.store so eligibleCount == 0.
        // hasWon mapping slot: keccak256(abi.encode(addr, slotIndex))
        // hasWon is at storage slot 9 (verified via `forge inspect Circle storage`).
        // NOTE: this slot shifts whenever the inheritance chain or variable order
        // changes (the previous VRF base contributed storage of its own ahead of
        // Circle's variables; IEntropyConsumer is stateless). Re-check with
        // `forge inspect` if either ever changes.
        // For a mapping: element slot = keccak256(abi.encode(key, mappingSlot))
        uint256 hasWonSlot = 9;
        for (uint256 i = 0; i < addrs.length; i++) {
            bytes32 slot = keccak256(abi.encode(addrs[i], hasWonSlot));
            vm.store(address(circle), slot, bytes32(uint256(1)));
            assertTrue(circle.hasWon(addrs[i]), "vm.store did not set hasWon");
        }

        // Now fulfillRandomness should see eligibleCount==0 and stall
        vrf.fulfillLatest(address(circle), 12345);
        assertEq(uint256(circle.state()), uint256(Circle.State.STALLED),
            "should transition to STALLED when no eligible members");
    }

    // ─── Entropy authorization (B0) ───────────────────────────────────────────

    /// @notice When a real Entropy contract is configured, ONLY it may deliver
    ///         the draw. This is what makes the winner un-forgeable in
    ///         production: without it, any caller could submit chosen randomness
    ///         and hand themselves the pot.
    function test_onlyEntropyMayFulfil() public {
        MockEntropy keeperVrf = new MockEntropy(VRF_FEE);
        address keeper = address(keeperVrf);
        CircleFactory f = new CircleFactory(address(new Circle()), address(stable), address(0), keeper);
        Circle c = Circle(payable(f.createCircle{value: VRF_BUDGET}(CONTRIB, SEATS, BOND, Mode.LUCKY_DRAW)));
        assertEq(c.entropyContract(), keeper);

        // Fill + drive the circle to DRAW.
        address[] memory ms = new address[](SEATS);
        for (uint160 i = 0; i < SEATS; i++) {
            address m = address(uint160(0x9000 + i));
            ms[i] = m;
            deal(address(stable), m, (BOND + CONTRIB) * 20);
            vm.prank(m); stable.approve(address(c), type(uint256).max);
            vm.prank(m); c.join();
        }
        for (uint256 i = 0; i < SEATS; i++) {
            vm.prank(ms[i]);
            c.commit(_commitment(ms[i], CONTRIB, bytes32(uint256(700 + i))));
        }
        c.advanceToReveal();
        for (uint256 i = 0; i < SEATS; i++) {
            vm.prank(ms[i]);
            c.reveal(CONTRIB, bytes32(uint256(700 + i)));
        }
        assertEq(uint256(c.state()), uint256(Circle.State.DRAW));
        c.requestDraw();

        uint64 seq = c.vrfSequenceNumber();

        // A random address must NOT be able to fulfil. IEntropyConsumer's
        // external _entropyCallback rejects any caller that is not getEntropy().
        vm.prank(address(0xBAD));
        vm.expectRevert("Only Entropy can call this function");
        c._entropyCallback(seq, address(0xBAD), bytes32(uint256(12345)));

        // Nobody won off the back of the rejected call.
        for (uint256 i = 0; i < SEATS; i++) {
            assertFalse(c.hasWon(ms[i]), "forged fulfilment must not pick a winner");
        }

        // The configured Entropy contract can.
        keeperVrf.fulfill(address(c), seq, bytes32(uint256(12345)));
        uint256 wins;
        for (uint256 i = 0; i < SEATS; i++) if (c.hasWon(ms[i])) wins++;
        assertEq(wins, 1, "Entropy's fulfilment should pick exactly one winner");
    }

    /// @notice A callback carrying a sequence number that does not match the
    ///         in-flight request must be a silent no-op — NOT a revert. Pyth's
    ///         keeper cannot re-deliver a callback that reverts, so reverting on
    ///         a stale/duplicate sequence would strand the real draw forever.
    function test_mismatchedSequenceNumberIsNoOp() public {
        MockEntropy keeperVrf = new MockEntropy(VRF_FEE);
        CircleFactory f = new CircleFactory(address(new Circle()), address(stable), address(0), address(keeperVrf));
        Circle c = Circle(payable(f.createCircle{value: VRF_BUDGET}(CONTRIB, SEATS, BOND, Mode.LUCKY_DRAW)));

        address[] memory ms = new address[](SEATS);
        for (uint160 i = 0; i < SEATS; i++) {
            address m = address(uint160(0x9500 + i));
            ms[i] = m;
            deal(address(stable), m, (BOND + CONTRIB) * 20);
            vm.prank(m); stable.approve(address(c), type(uint256).max);
            vm.prank(m); c.join();
        }
        for (uint256 i = 0; i < SEATS; i++) {
            vm.prank(ms[i]);
            c.commit(_commitment(ms[i], CONTRIB, bytes32(uint256(800 + i))));
        }
        c.advanceToReveal();
        for (uint256 i = 0; i < SEATS; i++) {
            vm.prank(ms[i]);
            c.reveal(CONTRIB, bytes32(uint256(800 + i)));
        }
        c.requestDraw();

        uint64 wrongSeq = c.vrfSequenceNumber() + 99;

        // Does not revert...
        keeperVrf.fulfill(address(c), wrongSeq, bytes32(uint256(4242)));

        // ...and does not draw: still in DRAW, no winner, pot untouched.
        assertEq(uint256(c.state()), uint256(Circle.State.DRAW), "must stay in DRAW");
        for (uint256 i = 0; i < SEATS; i++) {
            assertFalse(c.hasWon(ms[i]), "mismatched sequence must not pick a winner");
        }
        assertEq(c.roundPool(), CONTRIB * SEATS, "pot must be untouched");

        // The correct sequence still works afterwards — the draw is not stranded.
        keeperVrf.fulfill(address(c), c.vrfSequenceNumber(), bytes32(uint256(4242)));
        uint256 wins;
        for (uint256 i = 0; i < SEATS; i++) if (c.hasWon(ms[i])) wins++;
        assertEq(wins, 1, "correct sequence should still draw");
    }
}
