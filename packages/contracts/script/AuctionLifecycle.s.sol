// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {Circle, Mode} from "../src/Circle.sol";
import {CircleFactory} from "../src/CircleFactory.sol";
import {MockStable} from "../src/MockStable.sol";

/// @notice Drives a full on-chain AUCTION-mode circle lifecycle on Monad testnet:
///         create -> 3 members join -> 3 rounds of commit/reveal-bid/draw with
///         dividend distribution -> completion. Uses ephemeral member wallets
///         funded (gas + mUSDC) from the deployer. Logs state + a conservation
///         check after every round.
///
///         Env: PRIVATE_KEY (deployer), FACTORY, STABLE (deployed addresses).
contract AuctionLifecycle is Script {
    uint256 constant CONTRIB = 10e6;      // 10 mUSDC
    uint256 constant SEATS   = 3;
    uint256 constant BOND    = (SEATS - 1) * CONTRIB; // 20 mUSDC

    CircleFactory factory;
    MockStable    stable;
    Circle        circle;

    uint256 deployerKey;
    address deployer;

    // Ephemeral member keys (derived deterministically; testnet throwaways).
    uint256[3] mkeys;
    address[3] members;

    function run() external {
        deployerKey = vm.envUint("PRIVATE_KEY");
        deployer    = vm.addr(deployerKey);
        factory     = CircleFactory(vm.envAddress("FACTORY"));
        stable      = MockStable(vm.envAddress("STABLE"));

        for (uint256 i = 0; i < 3; i++) {
            mkeys[i]   = uint256(keccak256(abi.encodePacked("bhishi-auction-member", i, deployer)));
            members[i] = vm.addr(mkeys[i]);
        }

        _fundMembers();
        _createAndJoin();

        for (uint256 round = 0; round < SEATS; round++) {
            _runRound(round);
            _report(round);
        }

        require(uint256(circle.state()) == uint256(Circle.State.COMPLETED), "circle not COMPLETED");
        console.log("\n=== ALL ROUNDS COMPLETE. Circle state = COMPLETED ===");
        for (uint256 i = 0; i < 3; i++) {
            require(circle.hasWon(members[i]), "a member never won");
            console.log("member", i, "hasWon:", circle.hasWon(members[i]));
        }
    }

    function _fundMembers() internal {
        // Gas (MON) + mUSDC for each member. Each needs BOND + SEATS*CONTRIB
        // = 20 + 30 = 50 mUSDC. Deployer mints via faucet then transfers.
        vm.startBroadcast(deployerKey);
        // Pull a chunk of mUSDC to the deployer from the faucet (500 mUSDC).
        stable.faucet();
        for (uint256 i = 0; i < 3; i++) {
            stable.transfer(members[i], BOND + SEATS * CONTRIB);
            payable(members[i]).transfer(0.3 ether); // MON for gas
        }
        vm.stopBroadcast();
    }

    function _createAndJoin() internal {
        vm.broadcast(deployerKey);
        circle = Circle(factory.createCircle(CONTRIB, SEATS, BOND, Mode.AUCTION));
        console.log("Circle (AUCTION) created at:", address(circle));

        for (uint256 i = 0; i < 3; i++) {
            vm.startBroadcast(mkeys[i]);
            stable.approve(address(circle), type(uint256).max);
            circle.join();
            vm.stopBroadcast();
        }
        console.log("3 members joined. state:", uint256(circle.state())); // expect COMMIT(3)
    }

    function _runRound(uint256 round) internal {
        // Distinct increasing bids so there's a unique highest bidder each round
        // (exercises the outright-winner path). Non-winners only.
        // roundPool = (#non-winners this round) * CONTRIB; cap = 40% of that.
        // With bids 1/2/3 mUSDC they're always under cap for 3-,2-,1-member pools.
        uint256[3] memory bids = [uint256(1e6), uint256(2e6), uint256(3e6)];
        bytes32 salt = keccak256(abi.encodePacked("salt", round));

        // COMMIT
        for (uint256 i = 0; i < 3; i++) {
            if (circle.hasWon(members[i])) continue; // auto-advanced
            bytes32 c = keccak256(abi.encodePacked(bids[i], salt, members[i]));
            vm.broadcast(mkeys[i]);
            circle.commit(c);
        }

        vm.broadcast(deployerKey);
        circle.advanceToReveal();

        // REVEAL
        for (uint256 i = 0; i < 3; i++) {
            if (circle.hasWon(members[i])) continue;
            vm.broadcast(mkeys[i]);
            circle.reveal(bids[i], salt);
        }

        // DRAW. The deployer must be the circle's configured vrfOperator (Gelato's
        // dedicated msg.sender in production) for this fulfilment to be accepted.
        vm.broadcast(deployerKey);
        circle.requestDraw();
        vm.broadcast(deployerKey);
        circle.fulfillRandomness(uint256(keccak256(abi.encodePacked("rand", round))), _vrfPayload(round));
    }

    function _report(uint256 round) internal view {
        console.log("\n--- after round", round, "---");
        console.log("state:", uint256(circle.state()));
        console.log("currentRound:", circle.currentRound());
        uint256 totalClaim;
        uint256 totalBond;
        for (uint256 i = 0; i < 3; i++) {
            (bool joined, uint256 bond,, uint256 claim) = circle.memberInfo(members[i]);
            console.log("  member", i);
            console.log("    hasWon:", circle.hasWon(members[i]));
            console.log("    claimable:", claim);
            console.log("    bond:", bond);
            if (joined) { totalClaim += claim; totalBond += bond; }
        }
        // Conservation: contract balance == claimable + dust + undrawn + bonds
        uint256 bal   = stable.balanceOf(address(circle));
        uint256 rhs   = totalClaim + circle.dustAccrued() + circle.undrawnPools() + totalBond;
        console.log("  contractBalance:", bal);
        console.log("  claim+dust+undrawn+bonds:", rhs);
        require(bal == rhs, "CONSERVATION VIOLATED on-chain");
        console.log("  [OK] conservation holds");
    }

    /// @notice Rebuild the exact `dataWithRound` payload Gelato echoes back to
    ///         the consumer: abi.encode(round, abi.encode(requestId, extraData)).
    ///         Mirrors GelatoVRFConsumerBase's private _round(). The consumer
    ///         SILENTLY ignores a fulfilment whose hash does not match the one it
    ///         stored at request time, so the round used here must be the round of
    ///         the block in which requestDraw() ran.
    function _vrfPayload(uint256 requestId) internal view returns (bytes memory) {
        uint256 elapsedFromGenesis = block.timestamp - 1692803367;
        uint256 currentRound = (elapsedFromGenesis / 3) + 1;
        uint256 round_ = block.chainid == 1 ? currentRound + 4 : currentRound + 1;
        return abi.encode(round_, abi.encode(requestId, bytes("")));
    }
}
