// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {Circle} from "../src/Circle.sol";
import {CircleFactory} from "../src/CircleFactory.sol";
import {ReputationRegistry} from "../src/ReputationRegistry.sol";

/// @notice Design A redeploy: rolls out the Circle.sol fix (winners pay every
///         round, persistent bid history) WITHOUT orphaning existing state.
///
///         Reuses the EXISTING MockStable (`STABLE` env var) so members' mUSDC
///         balances stay valid. Deploys a NEW Circle implementation (the fixed
///         one) and a NEW CircleFactory pointing at the existing stable token.
///
///         ReputationRegistry.factory is immutable and gates writes via
///         `isCircle(msg.sender)` against ONE specific factory address — so a
///         new factory means old circles it doesn't recognize as "its own"
///         would be rejected by the old registry. We therefore also deploy a
///         NEW ReputationRegistry wired to the new factory (mirrors the
///         precompute pattern in Deploy.s.sol). Old circles keep writing to
///         the OLD registry via the OLD factory — nothing is orphaned there
///         either, since old circles were never touched.
///
///         Existing circles on the OLD factory are UNAFFECTED (this script
///         deploys new contracts; it does not touch the old ones). They keep
///         running against the old (buggy) Circle implementation until they
///         complete or stall — see DESIGN_A_PLAN.md Part 7 note re: the
///         stuck 0x3e1A…9a8F circle.
contract DeployDesignA is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        address existingStable = vm.envAddress("STABLE");

        vm.startBroadcast(deployerKey);

        // 1. New Circle implementation (the Design A fix).
        Circle circleImpl = new Circle();
        console.log("Circle impl (Design A):", address(circleImpl));

        // 2. Precompute the new factory's address so the new registry can be
        //    constructed with it (same two-step pattern as Deploy.s.sol).
        uint256 nonce = vm.getNonce(deployer);
        address futureFactoryAddr = vm.computeCreateAddress(deployer, nonce + 1);

        ReputationRegistry reputation = new ReputationRegistry(futureFactoryAddr);
        console.log("ReputationRegistry (new):", address(reputation));

        address entropy = vm.envOr("PYTH_ENTROPY", address(0));
        if (entropy == address(0)) {
            console.log("WARNING: PYTH_ENTROPY unset -> circles will be PERMISSIONLESS (anyone can draw)");
        } else {
            console.log("Pyth Entropy:", entropy);
        }

        CircleFactory factory = new CircleFactory(address(circleImpl), existingStable, address(reputation), entropy);
        console.log("CircleFactory (new):", address(factory));

        require(address(factory) == futureFactoryAddr, "factory address mismatch");

        vm.stopBroadcast();

        console.log("\n=== Design A Redeploy ===");
        console.log("Reused MockStable:   ", existingStable);
        console.log("Circle (impl):       ", address(circleImpl));
        console.log("ReputationRegistry:  ", address(reputation));
        console.log("CircleFactory:       ", address(factory));
        console.log("\nUpdate packages/shared/src/addresses.ts: factory, reputation, circleImpl.");
        console.log("Leave mockStable UNCHANGED - it was reused, not redeployed.");
    }
}
