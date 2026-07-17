// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Circle, Mode} from "../src/Circle.sol";
import {CircleFactory} from "../src/CircleFactory.sol";
import {ReentrantToken} from "./mocks/ReentrantToken.sol";
import {MockVRF} from "./mocks/MockVRF.sol";

/// @notice Proves that Circle.claim() is safe against reentrancy attacks.
///         CEI (Checks-Effects-Interactions) zeros the claimable balance before
///         the ERC20 transfer, so a malicious token that calls back into claim()
///         during transfer hits NothingToClaim on the nested call.
///         The nonReentrant modifier provides a belt-and-suspenders guard.
contract ReentrancyHarnessTest is Test {
    ReentrantToken internal token;
    CircleFactory  internal factory;
    MockVRF        internal vrf;
    Circle         internal circle;

    uint256 internal constant CONTRIB = 100e6;
    uint256 internal constant SEATS   = 2;
    uint256 internal constant BOND    = (SEATS - 1) * CONTRIB; // 100e6

    bytes32 constant SALT = bytes32(uint256(0xBEEF));

    address internal alice = address(0xA11CE);
    address internal bob   = address(0xB0B);

    function setUp() public {
        token  = new ReentrantToken();  // mints 1_000_000e6 to this contract
        vrf    = new MockVRF();
        address impl = address(new Circle());
        factory = new CircleFactory(impl, address(token), address(0), address(vrf));
        circle  = Circle(factory.createCircle(CONTRIB, SEATS, BOND, Mode.LUCKY_DRAW));

        // Wire up the attack target
        token.setTarget(address(circle));

        // Fund and approve both members
        token.transfer(alice, BOND + CONTRIB * 10);
        token.transfer(bob,   BOND + CONTRIB * 10);

        vm.prank(alice);
        token.approve(address(circle), type(uint256).max);
        vm.prank(bob);
        token.approve(address(circle), type(uint256).max);

        // Both join
        vm.prank(alice);
        circle.join();
        vm.prank(bob);
        circle.join();
        // Circle is now in COMMIT state

        // Play one full round so alice has a claimable balance
        _playOneRound(0 /* rand=0 → alice wins if she's first eligible */);
    }

    /// @notice Full round: commit → advanceToReveal → reveal → requestDraw → fulfillRandomness
    /// Counts requestDraw calls so far: the circle's requestId counter starts
    /// at 0 and increments once per request.
    uint256 internal nextRequestId;

    function _playOneRound(uint256 rand) internal {
        address[2] memory members = [alice, bob];

        // Commit
        for (uint256 i = 0; i < 2; i++) {
            address m = members[i];
            (bool joined,,,) = circle.memberInfo(m);
            if (!joined) continue;
            bytes32 c = keccak256(abi.encodePacked(CONTRIB, SALT, m));
            vm.prank(m);
            circle.commit(c);
        }
        circle.advanceToReveal();

        // Reveal
        for (uint256 i = 0; i < 2; i++) {
            address m = members[i];
            (bool joined,,,) = circle.memberInfo(m);
            if (!joined) continue;
            if (!circle.committed(m)) continue;
            vm.prank(m);
            circle.reveal(CONTRIB, SALT);
        }

        // Draw
        circle.requestDraw();
        vrf.fulfill(address(circle), nextRequestId++, rand);
    }

    /// @notice Core reentrancy test:
    ///         1. Alice has a claimable balance from winning the pot.
    ///         2. We arm the ReentrantToken to call circle.claim() during transfer.
    ///         3. Alice calls claim() — the outer call zeros her balance BEFORE
    ///            transferring (CEI), so the nested claim() inside the token transfer
    ///            finds claimable == 0 and reverts with NothingToClaim.
    ///         4. The outer transfer completes normally (ReentrantToken resets the
    ///            attacking flag so the nested failure doesn't propagate).
    ///         5. Alice receives exactly her claimable — NOT 2x.
    function test_reentrantTokenCannotDoubleWithdraw() public {
        // Verify alice has something to claim
        (,,, uint256 aliceClaimable) = circle.memberInfo(alice);
        assertGt(aliceClaimable, 0, "alice has nothing to claim - test setup failed");

        uint256 aliceBalanceBefore = token.balanceOf(alice);

        // Arm the attack: token will call circle.claim() during transfer
        token.setAttacking(true);

        // Alice calls claim() — this triggers the reentrancy attempt
        vm.prank(alice);
        circle.claim(); // should succeed (outer call), nested call silently fails

        uint256 aliceBalanceAfter = token.balanceOf(alice);
        uint256 received = aliceBalanceAfter - aliceBalanceBefore;

        // Alice received exactly her original claimable, NOT 2x
        assertEq(received, aliceClaimable, "reentrancy doubled the withdrawal");

        // Alice has no remaining claimable
        (,,, uint256 remainingClaimable) = circle.memberInfo(alice);
        assertEq(remainingClaimable, 0, "claimable not zeroed after claim");
    }

    /// @notice Control: without attack flag, claim works normally
    function test_normalClaimWorksWithReentrantToken() public {
        (,,, uint256 aliceClaimable) = circle.memberInfo(alice);
        assertGt(aliceClaimable, 0, "alice has nothing to claim");

        uint256 before = token.balanceOf(alice);
        vm.prank(alice);
        circle.claim();

        assertEq(token.balanceOf(alice) - before, aliceClaimable, "wrong amount received");
    }
}
