// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockStable} from "../src/MockStable.sol";

contract MockStableTest is Test {
    MockStable stable;

    function setUp() public {
        stable = new MockStable();
    }

    function test_decimalsIsSix() public view {
        assertEq(stable.decimals(), 6);
    }

    function test_faucetMintsToCaller() public {
        vm.prank(address(0xBEEF));
        stable.faucet();
        assertEq(stable.balanceOf(address(0xBEEF)), 500 * 1e6);
    }

    function test_faucetCooldownReverts() public {
        vm.startPrank(address(0xBEEF));
        stable.faucet();
        vm.expectRevert(MockStable.FaucetCooldown.selector);
        stable.faucet();
    }
}
