// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {MockStable} from "../src/MockStable.sol";
import {ReputationRegistry} from "../src/ReputationRegistry.sol";
import {Circle} from "../src/Circle.sol";
import {CircleFactory} from "../src/CircleFactory.sol";

contract Deploy is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);

        // 1. MockStable (testnet faucet stablecoin)
        MockStable stable = new MockStable();
        console.log("MockStable:", address(stable));

        // 2. Circle implementation (for clones)
        Circle circleImpl = new Circle();
        console.log("Circle impl:", address(circleImpl));

        // 3. ReputationRegistry (needs factory address — use CREATE2 prediction or deploy then set)
        // Pattern: deploy factory with placeholder reputation, then deploy reputation, then update
        // Simpler: deploy reputation with a placeholder factory, deploy factory, then reputation accepts factory as constructor arg
        // Use approach: deploy reputation AFTER factory, pass factory address
        //
        // Actually deploy factory first with address(0) reputation placeholder —
        // No: factory constructor takes reputation. Use a two-step:
        // Step 1: deploy factory with deployer as temp reputation
        // Step 2: deploy real reputation pointing to factory
        // Step 3: Re-deploy factory with real reputation OR accept that reputation address is stored in circles (not factory)
        // Cleanest: deploy factory first with address(0) reputation, then deploy reputation with factory address.
        // Circle stores reputation from factory's initialize call — factory passes its stored reputation.
        // So factory needs reputation at construction. Use vm.computeCreateAddress to precompute:

        // Precompute factory address (deployer nonce at this point = 2, since stable=0, circleImpl=1, factory=2)
        uint256 nonce = vm.getNonce(deployer);
        address futureFactoryAddr = vm.computeCreateAddress(deployer, nonce + 1); // reputation is nonce, factory is nonce+1

        ReputationRegistry reputation = new ReputationRegistry(futureFactoryAddr);
        console.log("ReputationRegistry:", address(reputation));

        CircleFactory factory = new CircleFactory(address(circleImpl), address(stable), address(reputation));
        console.log("CircleFactory:", address(factory));

        // Sanity check: factory address matches prediction
        require(address(factory) == futureFactoryAddr, "factory address mismatch");

        vm.stopBroadcast();

        console.log("\n=== Deployed Addresses ===");
        console.log("MockStable:         ", address(stable));
        console.log("Circle (impl):      ", address(circleImpl));
        console.log("ReputationRegistry: ", address(reputation));
        console.log("CircleFactory:      ", address(factory));
        console.log("\nUpdate packages/shared/src/addresses.ts with these values.");
    }
}
