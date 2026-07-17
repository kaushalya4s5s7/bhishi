// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CircleFactory} from "../src/CircleFactory.sol";
import {Circle, Mode} from "../src/Circle.sol";
import {MockStable} from "../src/MockStable.sol";

contract CircleFactoryTest is Test {
    CircleFactory internal factory;
    MockStable internal stable;
    address internal impl;

    uint256 internal constant CONTRIB = 100e6;
    uint256 internal constant SEATS = 4;
    uint256 internal constant VALID_BOND = (SEATS - 1) * CONTRIB; // 300e6

    function setUp() public {
        stable = new MockStable();
        impl = address(new Circle());
        factory = new CircleFactory(impl, address(stable), address(0), address(0));
    }

    function test_createCircleDeploysCloneAndRegisters() public {
        address c = factory.createCircle(CONTRIB, SEATS, VALID_BOND, Mode.LUCKY_DRAW);
        assertTrue(factory.isCircle(c));
        assertTrue(c.code.length > 0);
    }

    function test_underSizedBondReverts() public {
        uint256 tooLow = (SEATS - 1) * CONTRIB - 1;
        vm.expectRevert(CircleFactory.BondTooLow.selector);
        factory.createCircle(CONTRIB, SEATS, tooLow, Mode.LUCKY_DRAW);
    }

    function test_isCircleFalseForRandomAddress() public {
        assertFalse(factory.isCircle(address(0xDEAD)));
    }

    function test_clonesHaveIsolatedStorage() public {
        address a = factory.createCircle(CONTRIB, SEATS, VALID_BOND, Mode.LUCKY_DRAW);
        address b = factory.createCircle(CONTRIB, SEATS, VALID_BOND, Mode.LUCKY_DRAW);
        assertTrue(a != b);
    }

    // ─── Entropy wiring (B0) ──────────────────────────────────────────────────

    /// @notice The factory's configured entropy contract must be threaded into
    ///         every circle it creates — not hardcoded to address(0) (which would
    ///         leave the draw callback permissionless, i.e. anyone could pick
    ///         winners).
    function test_factoryThreadsEntropyIntoCircles() public {
        address keeper = address(0xCAFE01);
        CircleFactory f = new CircleFactory(impl, address(stable), address(0), keeper);
        assertEq(f.entropy(), keeper, "factory should expose its entropy contract");

        Circle c = Circle(payable(f.createCircle(CONTRIB, SEATS, VALID_BOND, Mode.LUCKY_DRAW)));
        assertEq(c.entropyContract(), keeper, "circle must inherit the factory's entropy contract");
    }

    /// @notice A factory configured with address(0) still yields permissionless
    ///         circles — kept deliberately for local/dev and the demo scripts.
    function test_zeroEntropyFactoryYieldsPermissionlessCircle() public {
        Circle c = Circle(payable(factory.createCircle(CONTRIB, SEATS, VALID_BOND, Mode.LUCKY_DRAW)));
        assertEq(c.entropyContract(), address(0));
    }

    /// @notice The factory must record the real caller as the circle's creator —
    ///         not itself — or leftover VRF funding would refund to the factory
    ///         (where it is unrecoverable) instead of the person who paid it.
    function test_factoryThreadsCallerAsCreator() public {
        address maker = address(0xBEEF01);
        vm.prank(maker);
        Circle c = Circle(payable(factory.createCircle(CONTRIB, SEATS, VALID_BOND, Mode.LUCKY_DRAW)));
        assertEq(c.creator(), maker, "creator must be createCircle's caller");
    }
}
