// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CircleFactory} from "../src/CircleFactory.sol";
import {Circle, Mode} from "../src/Circle.sol";
import {MockStable} from "../src/MockStable.sol";
import {MockVRF} from "./mocks/MockVRF.sol";

contract FairnessTest is Test {
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
        factory = new CircleFactory(impl, address(stable), address(0), address(vrf));
        circle  = Circle(factory.createCircle(CONTRIB, SEATS, BOND, Mode.LUCKY_DRAW));

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
        vrf.fulfill(address(circle), 0, uint256(keccak256("seed1")));

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
            vrf.fulfill(address(circle), r, seeds[r]);

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
        // hasWon is the 4th new storage var after vrfOperator(slot N), drawRequestedAt(N+1), hasWon(N+2).
        // Rather than calculating slots, we use a simpler approach: fulfill once to mark
        // the first winner, then manually set hasWon for remaining two via store.
        // Actually simplest: just use cheatcode store on each member's hasWon slot.

        // hasWon is at storage slot 10 (verified via `forge inspect Circle storage`).
        // NOTE: it moved from slot 8 -> 10 when Circle inherited
        // GelatoVRFConsumerBase, whose requestPending/requestedHash occupy slots
        // 0 and 1 ahead of Circle's own variables. Re-check with `forge inspect`
        // if the inheritance chain or variable order ever changes.
        // For a mapping: element slot = keccak256(abi.encode(key, mappingSlot))
        uint256 hasWonSlot = 10;
        for (uint256 i = 0; i < addrs.length; i++) {
            bytes32 slot = keccak256(abi.encode(addrs[i], hasWonSlot));
            vm.store(address(circle), slot, bytes32(uint256(1)));
            assertTrue(circle.hasWon(addrs[i]), "vm.store did not set hasWon");
        }

        // Now fulfillRandomness should see eligibleCount==0 and stall
        vrf.fulfill(address(circle), 0, 12345);
        assertEq(uint256(circle.state()), uint256(Circle.State.STALLED),
            "should transition to STALLED when no eligible members");
    }

    // ─── VRF operator authorization (B0) ──────────────────────────────────────

    /// @notice When a real vrfOperator is configured, ONLY that operator may
    ///         fulfil the draw. This is what makes the winner un-forgeable in
    ///         production: without it, any caller could submit chosen randomness
    ///         and hand themselves the pot.
    function test_onlyVrfOperatorMayFulfil() public {
        // The operator is a MockVRF so it can build the exact dataWithRound
        // payload Gelato's base contract demands.
        MockVRF keeperVrf = new MockVRF();
        address keeper = address(keeperVrf);
        CircleFactory f = new CircleFactory(address(new Circle()), address(stable), address(0), keeper);
        Circle c = Circle(f.createCircle(CONTRIB, SEATS, BOND, Mode.LUCKY_DRAW));
        assertEq(c.vrfOperator(), keeper);

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

        // Build the payload BEFORE arming the cheatcodes: an intervening call to
        // the mock would consume the prank / expectRevert.
        bytes memory data = keeperVrf.payload(0);

        // A random address must NOT be able to fulfil. The Gelato base rejects
        // any caller that is not the dedicated msg.sender.
        vm.prank(address(0xBAD));
        vm.expectRevert("only operator");
        c.fulfillRandomness(12345, data);

        // The configured operator can.
        keeperVrf.fulfill(address(c), 0, 12345);
        uint256 wins;
        for (uint256 i = 0; i < SEATS; i++) if (c.hasWon(ms[i])) wins++;
        assertEq(wins, 1, "operator's fulfilment should pick exactly one winner");
    }
}
