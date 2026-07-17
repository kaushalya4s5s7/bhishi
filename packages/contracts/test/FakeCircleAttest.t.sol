// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Circle, Mode} from "../src/Circle.sol";
import {CircleFactory} from "../src/CircleFactory.sol";
import {ReputationRegistry} from "../src/ReputationRegistry.sol";
import {MockStable} from "../src/MockStable.sol";
import {FakeCircle} from "./mocks/FakeCircle.sol";

/// @notice LEAK 4: factory-gated reputation — only real, COMPLETED circles
///         can write attestations; forged callers revert.
contract FakeCircleAttestTest is Test {
    MockStable        internal stable;
    CircleFactory     internal factory;
    ReputationRegistry internal reputation;

    uint256 internal constant CONTRIB = 100e6;
    uint256 internal constant SEATS   = 2;
    uint256 internal constant BOND    = 200e6; // >= (seats-1)*contrib = 100e6 ✓

    address[] internal addrs;

    function setUp() public {
        stable = new MockStable();
        address impl = address(new Circle());
        // Circular dependency: factory needs reputation address; reputation needs factory address.
        // Resolution: predict the factory address using vm.computeCreateAddress, deploy registry
        // first, then deploy factory (which lands at the predicted address).
        address deployer  = address(this);
        uint256 factoryNonce = vm.getNonce(deployer) + 1; // registry deployed next (+0), factory after (+1)
        address predictedFactory = vm.computeCreateAddress(deployer, factoryNonce);
        reputation = new ReputationRegistry(predictedFactory);   // nonce +0
        factory    = new CircleFactory(impl, address(stable), address(reputation), address(0)); // nonce +1
        // Verify the prediction was correct
        require(address(factory) == predictedFactory, "factory address mismatch");
    }

    // ─── LEAK 4a: Fake circle cannot attest ─────────────────────────────────────

    function test_fakeCircleAttestReverts() public {
        FakeCircle fake = new FakeCircle(address(reputation));
        vm.expectRevert(ReputationRegistry.NotFactoryCircle.selector);
        fake.tryAttest(address(0xBEEF), 1);
    }

    // ─── LEAK 4b: Real completed circle writes attestations ──────────────────────

    function test_completedCircleWritesAttestation() public {
        Circle circle = Circle(factory.createCircle(CONTRIB, SEATS, BOND, Mode.LUCKY_DRAW));

        // Two members join
        for (uint160 i = 0; i < SEATS; i++) {
            address m = address(uint160(0x3000 + i));
            addrs.push(m);
            deal(address(stable), m, BOND + CONTRIB * 10);
            vm.prank(m);
            stable.approve(address(circle), type(uint256).max);
            vm.prank(m);
            circle.join();
        }

        // Fully play through the circle until COMPLETED
        _playToCompletion(circle);

        assertEq(uint256(circle.state()), uint256(Circle.State.COMPLETED), "circle not COMPLETED");

        // Every member should have score 1
        for (uint256 i = 0; i < addrs.length; i++) {
            assertEq(reputation.score(addrs[i]), 1, "member score not 1");
        }
    }

    // ─── LEAK 4c: EOA posing as circle cannot attest ────────────────────────────

    function test_EOAAttestReverts() public {
        vm.expectRevert(ReputationRegistry.NotFactoryCircle.selector);
        reputation.attest(address(0xBEEF), 1);
    }

    // ─── helper ─────────────────────────────────────────────────────────────────

    bytes32 constant SALT = bytes32(uint256(0xDEAD));

    function _isJoined(Circle circle, address m) internal view returns (bool) {
        (bool joined,,,) = circle.memberInfo(m);
        return joined;
    }

    function _playToCompletion(Circle circle) internal {
        uint256 n = addrs.length;
        uint256 rounds = n; // each member wins once

        for (uint256 r = 0; r < rounds; r++) {
            assertEq(uint256(circle.state()), uint256(Circle.State.COMMIT), "expected COMMIT");

            // Commit
            for (uint256 i = 0; i < n; i++) {
                address m = addrs[i];
                if (!_isJoined(circle, m)) continue;
                bytes32 c = keccak256(abi.encodePacked(CONTRIB, SALT, m));
                vm.prank(m);
                circle.commit(c);
            }

            circle.advanceToReveal();

            // Reveal
            for (uint256 i = 0; i < n; i++) {
                address m = addrs[i];
                if (!_isJoined(circle, m)) continue;
                if (!circle.committed(m)) continue;
                vm.prank(m);
                circle.reveal(CONTRIB, SALT);
            }

            assertEq(uint256(circle.state()), uint256(Circle.State.DRAW), "expected DRAW");
            circle.requestDraw();
            circle.fulfillRandomness(0, r, ""); // deterministic winner selection
        }
    }
}
