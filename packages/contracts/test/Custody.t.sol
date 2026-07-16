// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CircleFactory} from "../src/CircleFactory.sol";
import {Circle, Mode} from "../src/Circle.sol";
import {MockStable} from "../src/MockStable.sol";

/// @notice Money Shot 1 — No organizer custody / withdrawal backdoor.
contract CustodyTest is Test {
    CircleFactory internal factory;
    MockStable internal stable;
    Circle internal circle;

    address internal organizer = address(0xBEEF);

    function setUp() public {
        stable = new MockStable();
        address impl = address(new Circle());
        factory = new CircleFactory(impl, address(stable), address(0));
        // organizer creates circle
        vm.prank(organizer);
        circle = Circle(factory.createCircle(100e6, 2, 300e6, Mode.LUCKY_DRAW));
    }

    /// Circle has no withdraw function — organizer cannot pull funds.
    function test_organizerWithdrawReverts() public {
        bytes memory data = abi.encodeWithSignature("withdraw(uint256)", 1e6);
        vm.prank(organizer);
        (bool ok,) = address(circle).call(data);
        assertFalse(ok, "withdraw() must not exist or must revert");
    }

    /// There is no emergencyWithdraw either.
    function test_emergencyWithdrawReverts() public {
        bytes memory data = abi.encodeWithSignature("emergencyWithdraw()");
        vm.prank(organizer);
        (bool ok,) = address(circle).call(data);
        assertFalse(ok, "emergencyWithdraw() must not exist or must revert");
    }
}
