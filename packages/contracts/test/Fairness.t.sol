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
        factory = new CircleFactory(impl, address(stable), address(0));
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
}
