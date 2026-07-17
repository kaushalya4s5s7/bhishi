// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CircleFactory} from "../src/CircleFactory.sol";
import {Circle, Mode} from "../src/Circle.sol";
import {MockStable} from "../src/MockStable.sol";

contract FillingTest is Test {
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

    function _member(uint160 i) internal returns (address m) {
        m = address(uint160(0x1000 + i));
        deal(address(stable), m, STAKE);
        vm.prank(m);
        stable.approve(address(circle), STAKE);
    }

    function test_joinFillsSeatsThenActivates() public {
        assertEq(uint256(circle.state()), uint256(Circle.State.FILLING));
        for (uint160 i = 0; i < SEATS; i++) {
            address m = _member(i);
            vm.prank(m);
            circle.join();
        }
        // M4: last join transitions directly to COMMIT (skip transient ACTIVE)
        assertEq(uint256(circle.state()), uint256(Circle.State.COMMIT));
        assertEq(circle.memberCount(), SEATS);
    }

    function test_joinTwiceReverts() public {
        address m = _member(0);
        vm.prank(m);
        circle.join();
        // top up allowance for the second attempt so the revert is AlreadyJoined
        deal(address(stable), m, STAKE);
        vm.prank(m);
        stable.approve(address(circle), STAKE);
        vm.prank(m);
        vm.expectRevert(Circle.AlreadyJoined.selector);
        circle.join();
    }

    function test_joinRequiresBondPlusContribution() public {
        address m = address(uint160(0x2000));
        deal(address(stable), m, STAKE);
        // under-approve: only contribution, not the full stake
        vm.prank(m);
        stable.approve(address(circle), CONTRIB);
        vm.prank(m);
        vm.expectRevert();
        circle.join();
    }
}
