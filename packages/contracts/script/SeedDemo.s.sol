// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {MockStable} from "../src/MockStable.sol";
import {CircleFactory} from "../src/CircleFactory.sol";
import {Circle, Mode} from "../src/Circle.sol";

contract SeedDemo is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address factory = vm.envAddress("CIRCLE_FACTORY_ADDRESS");
        address stable = vm.envAddress("MOCK_STABLE_ADDRESS");

        // Simulated co-members (use well-known test addresses; user funds them separately)
        address[3] memory coMembers = [
            address(0x1111111111111111111111111111111111111111),
            address(0x2222222222222222222222222222222222222222),
            address(0x3333333333333333333333333333333333333333)
        ];

        vm.startBroadcast(deployerKey);

        uint256 CONTRIB = 10e6;  // 10 mUSDC
        uint256 SEATS = 4;
        uint256 BOND = 30e6;     // 30 mUSDC (= (4-1)*10)

        // Create demo circle
        address circleAddr = CircleFactory(factory).createCircle(CONTRIB, SEATS, BOND, Mode.LUCKY_DRAW);
        console.log("Demo circle:", circleAddr);

        // Fund + approve for deployer (joins as seat 0)
        MockStable(stable).faucet();
        MockStable(stable).approve(circleAddr, BOND);
        Circle(circleAddr).join();
        console.log("Deployer joined as seat 0");

        console.log("\nNext steps:");
        console.log("1. Fund coMembers with MON (gas) and call stable.faucet() for each");
        console.log("2. Each coMember approves circleAddr for BOND amount and calls join()");
        console.log("3. Set NEXT_PUBLIC_DEMO_CIRCLE_ADDRESS =", circleAddr, "in apps/web/.env.local");

        // Suppress unused variable warning
        coMembers;

        vm.stopBroadcast();
    }
}
