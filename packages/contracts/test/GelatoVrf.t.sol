// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, Vm} from "forge-std/Test.sol";
import {CircleFactory} from "../src/CircleFactory.sol";
import {Circle, Mode} from "../src/Circle.sol";
import {MockStable} from "../src/MockStable.sol";
import {IGelatoVRFConsumer} from "../src/vendor/gelato/IGelatoVRFConsumer.sol";

/// @notice Proves Circle is a real Gelato VRF consumer: requesting a draw emits
///         the RequestedRandomness event Gelato's nodes watch for, and only
///         Gelato's dedicated msg.sender can fulfil it with drand randomness.
contract GelatoVrfTest is Test {
    CircleFactory internal factory;
    MockStable internal stable;
    Circle internal circle;

    uint256 internal constant CONTRIB = 100e6;
    uint256 internal constant SEATS = 3;
    uint256 internal constant BOND = 200e6;

    /// Gelato's dedicated msg.sender for this VRF task.
    address internal constant OPERATOR = address(0x6E1A70);

    address[] internal members;

    event RequestedRandomness(uint256 round, bytes data);

    function setUp() public {
        stable = new MockStable();
        address impl = address(new Circle());
        factory = new CircleFactory(impl, address(stable), address(0), OPERATOR);
        circle = Circle(factory.createCircle(CONTRIB, SEATS, BOND, Mode.LUCKY_DRAW));

        for (uint160 i = 0; i < SEATS; i++) {
            address m = address(uint160(0x7000 + i));
            members.push(m);
            deal(address(stable), m, (BOND + CONTRIB) * 20);
            vm.prank(m); stable.approve(address(circle), type(uint256).max);
            vm.prank(m); circle.join();
        }
    }

    function _commitment(address who, uint256 amount, bytes32 salt) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(amount, salt, who));
    }

    /// Drive the circle to DRAW state.
    function _toDraw() internal {
        for (uint256 i = 0; i < members.length; i++) {
            vm.prank(members[i]);
            circle.commit(_commitment(members[i], CONTRIB, bytes32(uint256(i + 1))));
        }
        circle.advanceToReveal();
        for (uint256 i = 0; i < members.length; i++) {
            vm.prank(members[i]);
            circle.reveal(CONTRIB, bytes32(uint256(i + 1)));
        }
        assertEq(uint256(circle.state()), uint256(Circle.State.DRAW));
    }

    /// @notice requestDraw must emit Gelato's RequestedRandomness — that event
    ///         IS the request; Gelato's nodes watch for it. Without it, no draw
    ///         would ever be fulfilled.
    function test_requestDrawEmitsGelatoRequestedRandomness() public {
        _toDraw();

        vm.recordLogs();
        circle.requestDraw();

        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool found;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] == keccak256("RequestedRandomness(uint256,bytes)")) found = true;
        }
        assertTrue(found, "requestDraw must emit RequestedRandomness for Gelato to observe");
    }

    /// @notice Only Gelato's dedicated msg.sender may fulfil.
    function test_onlyGelatoOperatorMayFulfil() public {
        _toDraw();
        circle.requestDraw();

        bytes memory dataWithRound = _buildFulfilData(0);

        vm.prank(address(0xBAD));
        vm.expectRevert("only operator");
        circle.fulfillRandomness(12345, dataWithRound);
    }

    /// @notice The operator's fulfilment picks exactly one winner and advances
    ///         the round — the full happy path through Gelato's callback.
    function test_operatorFulfilmentDrawsWinner() public {
        _toDraw();
        circle.requestDraw();

        bytes memory dataWithRound = _buildFulfilData(0);

        vm.prank(OPERATOR);
        circle.fulfillRandomness(uint256(keccak256("drand")), dataWithRound);

        uint256 wins;
        for (uint256 i = 0; i < members.length; i++) if (circle.hasWon(members[i])) wins++;
        assertEq(wins, 1, "exactly one winner after Gelato fulfilment");
    }

    /// @notice Rebuild the exact `dataWithRound` payload Gelato echoes back:
    ///         abi.encode(round, abi.encode(requestId, extraData)).
    function _buildFulfilData(uint256 requestId) internal view returns (bytes memory) {
        // The round the base computed at request time; recomputed the same way.
        uint256 elapsed = block.timestamp - 1692803367;
        uint256 round = (elapsed / 3) + 1;
        round = block.chainid == 1 ? round + 4 : round + 1;
        bytes memory data = abi.encode(requestId, bytes(""));
        return abi.encode(round, data);
    }
}
