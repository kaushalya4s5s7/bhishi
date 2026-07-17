// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Circle, Mode} from "../src/Circle.sol";
import {CircleFactory} from "../src/CircleFactory.sol";
import {MockStable} from "../src/MockStable.sol";
import {MockEntropy} from "./mocks/MockEntropy.sol";
import {VrfFixture} from "./mocks/VrfFixture.sol";

/// @notice The sponsorship model: the CIRCLE pays Pyth Entropy's fee out of its
///         own MON balance, so members only ever spend the stable token. This is
///         the whole point of the Pyth migration — a member should never need to
///         hold native MON to take part in a ROSCA.
contract VrfSponsorshipTest is Test, VrfFixture {
    MockStable    internal stable;
    CircleFactory internal factory;
    MockEntropy   internal vrf;

    uint256 internal constant CONTRIB = 100e6;
    uint256 internal constant SEATS   = 3;
    uint256 internal constant BOND    = (SEATS - 1) * CONTRIB;

    address internal creator = address(0xC8EA704);
    address[] internal ms;

    function setUp() public {
        stable  = new MockStable();
        vrf     = new MockEntropy(VRF_FEE);
        address impl = address(new Circle());
        factory = new CircleFactory(impl, address(stable), address(0), address(vrf));
    }

    function _commitment(address who, uint256 amount, bytes32 salt) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(amount, salt, who));
    }

    /// Create a circle owned by `creator`, optionally funding it with MON.
    function _newCircle(uint256 funding) internal returns (Circle c) {
        vm.deal(creator, funding);
        vm.prank(creator);
        c = Circle(payable(factory.createCircle{value: funding}(CONTRIB, SEATS, BOND, Mode.LUCKY_DRAW)));
    }

    /// Fill the circle with members holding ZERO native MON.
    function _fill(Circle c, uint256 saltBase) internal {
        delete ms;
        for (uint160 i = 0; i < SEATS; i++) {
            address m = address(uint160(0x7000 + i));
            ms.push(m);
            deal(address(stable), m, (BOND + CONTRIB) * 20);
            vm.deal(m, 0); // members hold NO native MON
            vm.prank(m); stable.approve(address(c), type(uint256).max);
            vm.prank(m); c.join();
        }
        for (uint256 i = 0; i < SEATS; i++) {
            vm.prank(ms[i]);
            c.commit(_commitment(ms[i], CONTRIB, bytes32(saltBase + i)));
        }
        c.advanceToReveal();
        for (uint256 i = 0; i < SEATS; i++) {
            vm.prank(ms[i]);
            c.reveal(CONTRIB, bytes32(saltBase + i));
        }
        assertEq(uint256(c.state()), uint256(Circle.State.DRAW));
    }

    // ─── 1. unfunded circle cannot request ────────────────────────────────────

    /// @notice With Entropy configured but no MON in the circle, requestDraw must
    ///         revert with a precise error rather than bubbling up an opaque
    ///         out-of-funds failure from Pyth.
    function test_requestDrawUnfundedReverts() public {
        Circle c = _newCircle(0);
        _fill(c, 100);
        assertEq(address(c).balance, 0, "circle should be unfunded");

        vm.expectRevert(Circle.InsufficientVrfFunding.selector);
        c.requestDraw();

        // A failed request must leave the draw re-requestable once funded, not
        // wedge the circle by having recorded drawRequestedAt.
        assertEq(c.drawRequestedAt(), 0, "failed request must not mark the draw pending");
        vm.deal(address(c), VRF_FEE);
        c.requestDraw();
        assertTrue(c.drawRequestedAt() != 0, "funded request should succeed");
    }

    /// @notice A balance one wei short of the fee is still insufficient (proves
    ///         the check is against the real fee, not merely against zero).
    function test_requestDrawOneWeiShortReverts() public {
        Circle c = _newCircle(0);
        _fill(c, 200);
        vm.deal(address(c), VRF_FEE - 1);

        vm.expectRevert(Circle.InsufficientVrfFunding.selector);
        c.requestDraw();
    }

    // ─── 2. the circle pays, not the member ───────────────────────────────────

    /// @notice THE money shot: a funded circle pays the Entropy fee from its own
    ///         balance. The member who triggers the draw spends no native MON,
    ///         and the fee provably leaves the circle for Entropy.
    function test_circleSponsorsFeeMemberPaysNothing() public {
        Circle c = _newCircle(VRF_BUDGET);
        _fill(c, 300);

        address member = ms[0];
        uint256 memberBalBefore  = member.balance;
        uint256 circleBalBefore  = address(c).balance;
        uint256 entropyBalBefore = address(vrf).balance;

        assertEq(memberBalBefore, 0, "member holds no MON");
        assertEq(c.vrfFeeEstimate(), VRF_FEE, "fee quote should match Entropy");

        vm.prank(member);
        c.requestDraw();

        // The member is untouched...
        assertEq(member.balance, memberBalBefore, "member must not pay the VRF fee");
        // ...the circle paid exactly the fee...
        assertEq(address(c).balance, circleBalBefore - VRF_FEE, "circle must pay exactly the fee");
        // ...and Entropy received it.
        assertEq(address(vrf).balance, entropyBalBefore + VRF_FEE, "Entropy must receive the fee");

        // And the sponsored draw actually completes.
        vrf.fulfill(address(c), c.vrfSequenceNumber(), bytes32(uint256(0xABCD)));
        uint256 wins;
        for (uint256 i = 0; i < SEATS; i++) if (c.hasWon(ms[i])) wins++;
        assertEq(wins, 1, "sponsored draw should pick exactly one winner");
    }

    /// @notice Anyone can top a circle up with MON, and it is credited + evented.
    function test_receiveFundsCircleAndEmits() public {
        Circle c = _newCircle(0);
        address donor = address(0xD0405);
        vm.deal(donor, 1 ether);

        vm.expectEmit(false, false, false, true, address(c));
        emit Circle.VrfFunded(donor, 0.5 ether);

        vm.prank(donor);
        (bool ok, ) = address(c).call{value: 0.5 ether}("");
        assertTrue(ok, "circle must accept MON");
        assertEq(address(c).balance, 0.5 ether);
    }

    /// @notice The factory's funding quote must cover one draw per round.
    function test_vrfFundingForQuotesPerSeat() public view {
        assertEq(factory.vrfFundingFor(SEATS), VRF_FEE * SEATS);
    }

    /// @notice In permissionless mode (entropy unset) there is no fee to quote
    ///         and no funding required — local tests and demo scripts rely on it.
    function test_permissionlessModeQuotesZeroAndNeedsNoFunding() public {
        CircleFactory f = new CircleFactory(address(new Circle()), address(stable), address(0), address(0));
        assertEq(f.vrfFundingFor(SEATS), 0, "no entropy -> no funding needed");

        Circle c = Circle(payable(f.createCircle(CONTRIB, SEATS, BOND, Mode.LUCKY_DRAW)));
        assertEq(c.vrfFeeEstimate(), 0);

        // Drive to DRAW and request with a zero balance — must not revert.
        // All seats must fill before the circle enters COMMIT.
        for (uint160 i = 0; i < SEATS; i++) {
            address m = address(uint160(0x7700 + i));
            deal(address(stable), m, (BOND + CONTRIB) * 20);
            vm.prank(m); stable.approve(address(c), type(uint256).max);
            vm.prank(m); c.join();
        }
        for (uint160 i = 0; i < SEATS; i++) {
            address m = address(uint160(0x7700 + i));
            vm.prank(m); c.commit(_commitment(m, CONTRIB, bytes32(uint256(900 + i))));
        }
        c.advanceToReveal();
        for (uint160 i = 0; i < SEATS; i++) {
            address m = address(uint160(0x7700 + i));
            vm.prank(m); c.reveal(CONTRIB, bytes32(uint256(900 + i)));
        }
        assertEq(address(c).balance, 0);
        c.requestDraw();
        assertTrue(c.drawRequestedAt() != 0, "permissionless request needs no funding");
    }

    // ─── 3. leftover refunds to the creator ───────────────────────────────────

    /// @notice When the circle completes, unspent VRF sponsorship goes back to
    ///         the creator who put it up — it must not be stranded in the clone.
    function test_leftoverRefundedToCreatorOnCompletion() public {
        Circle c = _newCircle(VRF_BUDGET);
        _fill(c, 400);

        uint256 spent;
        // Run every round to completion.
        for (uint256 r = 0; r < SEATS; r++) {
            c.requestDraw();
            spent += VRF_FEE;
            vrf.fulfill(address(c), c.vrfSequenceNumber(), bytes32(uint256(keccak256(abi.encodePacked(r)))));
            if (c.state() == Circle.State.COMPLETED) break;

            // next round: commit + reveal again
            for (uint256 i = 0; i < SEATS; i++) {
                vm.prank(ms[i]);
                c.commit(_commitment(ms[i], CONTRIB, bytes32(uint256(400 + r * 10 + i))));
            }
            c.advanceToReveal();
            for (uint256 i = 0; i < SEATS; i++) {
                vm.prank(ms[i]);
                c.reveal(CONTRIB, bytes32(uint256(400 + r * 10 + i)));
            }
        }

        assertEq(uint256(c.state()), uint256(Circle.State.COMPLETED), "circle should complete");
        assertEq(address(c).balance, 0, "no MON may be stranded in the circle");
        assertEq(creator.balance, VRF_BUDGET - spent, "creator gets the unspent remainder back");
    }

    /// @notice Leftover MON is likewise returned on the STALLED safety-valve path.
    function test_leftoverRefundedToCreatorOnStall() public {
        Circle c = _newCircle(VRF_BUDGET);
        _fill(c, 500);

        c.requestDraw();
        // Entropy goes silent; the timeout elapses.
        vm.warp(block.timestamp + c.VRF_TIMEOUT() + 1);
        c.reclaimOnStall();

        assertEq(uint256(c.state()), uint256(Circle.State.STALLED));
        assertEq(address(c).balance, 0, "no MON may be stranded on stall");
        assertEq(creator.balance, VRF_BUDGET - VRF_FEE, "creator refunded on stall");
    }

    /// @notice A creator that rejects MON must NOT trap the ROSCA: the refund
    ///         fails, is reported via the event, and the circle still completes
    ///         so members can claim their stable. The native fee is a sideshow;
    ///         the ERC20 money path must never depend on it.
    function test_failedRefundDoesNotTrapCompletion() public {
        RejectsMon badCreator = new RejectsMon();
        vm.deal(address(badCreator), VRF_BUDGET);
        vm.prank(address(badCreator));
        Circle c = Circle(payable(factory.createCircle{value: VRF_BUDGET}(CONTRIB, SEATS, BOND, Mode.LUCKY_DRAW)));
        assertEq(c.creator(), address(badCreator));

        _fill(c, 600);
        c.requestDraw();
        vm.warp(block.timestamp + c.VRF_TIMEOUT() + 1);

        // Must not revert even though the creator rejects the refund.
        c.reclaimOnStall();

        assertEq(uint256(c.state()), uint256(Circle.State.STALLED), "stall must still succeed");
        assertEq(address(c).balance, VRF_BUDGET - VRF_FEE, "unrefundable MON stays put");

        // Members can still recover their stable — the real money path is intact.
        uint256 before = stable.balanceOf(ms[0]);
        vm.prank(ms[0]);
        c.claim();
        assertGt(stable.balanceOf(ms[0]), before, "members must still be able to claim");
    }
}

/// @notice A creator contract with no receive/fallback — rejects native MON.
contract RejectsMon {}
