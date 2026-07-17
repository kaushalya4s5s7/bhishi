// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CircleFactory} from "../src/CircleFactory.sol";
import {Circle, Mode} from "../src/Circle.sol";
import {MockStable} from "../src/MockStable.sol";

contract FillingTimeoutTest is Test {
    CircleFactory internal factory;
    MockStable internal stable;
    address internal impl;
    Circle internal circle;

    uint256 internal constant CONTRIB = 100e6;
    uint256 internal constant SEATS = 4;
    uint256 internal constant BOND = 300e6;
    uint256 internal constant STAKE = BOND + CONTRIB;

    function setUp() public {
        stable = new MockStable();
        impl = address(new Circle());
        factory = new CircleFactory(impl, address(stable), address(0), address(0));
        circle = Circle(payable(factory.createCircle(CONTRIB, SEATS, BOND, Mode.LUCKY_DRAW)));
    }

    function _join(uint160 i) internal returns (address m) {
        m = address(uint160(0x1000 + i));
        deal(address(stable), m, STAKE);
        vm.prank(m);
        stable.approve(address(circle), STAKE);
        vm.prank(m);
        circle.join();
    }

    function test_refundFillingAfterTimeoutReturnsBond() public {
        address a = _join(0);
        address b = _join(1);
        // only 2 of 4 seats filled -> still FILLING
        assertEq(uint256(circle.state()), uint256(Circle.State.FILLING));

        vm.warp(block.timestamp + circle.FILLING_TIMEOUT());

        // permissionless: a random caller triggers the refund
        vm.prank(address(0xBEEF));
        circle.refundFilling();

        assertEq(stable.balanceOf(a), STAKE);
        assertEq(stable.balanceOf(b), STAKE);
        assertEq(uint256(circle.state()), uint256(Circle.State.ABORTED_FILLING));
    }

    function test_refundFillingBeforeTimeoutReverts() public {
        _join(0);
        _join(1);
        vm.expectRevert(Circle.FillingNotTimedOut.selector);
        circle.refundFilling();
    }

    function test_seatsBelowTwoRejected() public {
        vm.expectRevert(Circle.InvalidSeats.selector);
        factory.createCircle(CONTRIB, 1, 0, Mode.LUCKY_DRAW);
    }

    function test_implementationInitializerLocked() public {
        vm.expectRevert(Circle.AlreadyInitialized.selector);
        Circle(payable(impl)).initialize(CONTRIB, SEATS, BOND, Mode.LUCKY_DRAW, address(stable), address(this), address(0), address(0), address(0));
    }
}
