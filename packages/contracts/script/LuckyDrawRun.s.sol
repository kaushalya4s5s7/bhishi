// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {Circle} from "../src/Circle.sol";
import {MockStable} from "../src/MockStable.sol";

/// @notice Linear (no-loop) full LUCKY_DRAW lifecycle against a pre-created
///         circle at a fixed address (env CIRCLE) — avoids CREATE prediction
///         drift and forge's "no staticcall after broadcast" loop pitfall.
///         The circle must already exist in FILLING with 3 seats; members are
///         the v3 ephemeral wallets, already funded with MON + mUSDC.
///
///         Env: PRIVATE_KEY (deployer/fulfiller), CIRCLE, STABLE.
contract LuckyDrawRun is Script {
    uint256 constant CONTRIB = 10e6;

    Circle     circle;
    MockStable stable;
    uint256    dk;
    uint256[3] mkeys;
    address[3] members;

    function run() external {
        dk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(dk);
        circle = Circle(vm.envAddress("CIRCLE"));
        stable = MockStable(vm.envAddress("STABLE"));
        for (uint256 i = 0; i < 3; i++) {
            mkeys[i]   = uint256(keccak256(abi.encodePacked("bhishi-luckydraw-member-v3", i, deployer)));
            members[i] = vm.addr(mkeys[i]);
        }

        // ── FILLING: approve + join (all three) ──
        for (uint256 i = 0; i < 3; i++) {
            vm.startBroadcast(mkeys[i]);
            stable.approve(address(circle), type(uint256).max);
            circle.join();
            vm.stopBroadcast();
        }

        // ── 3 rounds. LUCKY_DRAW: reveal amount == CONTRIB; winners keep
        //    committing/revealing every round (no auto-advance). ──
        _round(0);
        _round(1);
        _round(2);

        require(uint256(circle.state()) == uint256(Circle.State.COMPLETED), "not COMPLETED");
        console.log("LUCKY_DRAW circle COMPLETED. state:", uint256(circle.state()));
    }

    function _round(uint256 r) internal {
        bytes32 salt = keccak256(abi.encodePacked("ld-salt", r));
        for (uint256 i = 0; i < 3; i++) {
            bytes32 c = keccak256(abi.encodePacked(CONTRIB, salt, members[i]));
            vm.broadcast(mkeys[i]);
            circle.commit(c);
        }
        vm.broadcast(dk);
        circle.advanceToReveal();
        for (uint256 i = 0; i < 3; i++) {
            vm.broadcast(mkeys[i]);
            circle.reveal(CONTRIB, salt);
        }
        vm.broadcast(dk);
        circle.requestDraw();
        vm.broadcast(dk);
        circle.fulfillRandomness(uint256(keccak256(abi.encodePacked("ld-rand", r))), _vrfPayload(r));
    }

    /// @notice Rebuild the exact `dataWithRound` payload Gelato echoes back to
    ///         the consumer: abi.encode(round, abi.encode(requestId, extraData)).
    ///         Mirrors GelatoVRFConsumerBase's private _round(). The consumer
    ///         SILENTLY ignores a fulfilment whose hash does not match the one it
    ///         stored at request time, so the round used here must be the round of
    ///         the block in which requestDraw() ran.
    function _vrfPayload(uint256 requestId) internal view returns (bytes memory) {
        uint256 elapsedFromGenesis = block.timestamp - 1692803367;
        uint256 currentRound = (elapsedFromGenesis / 3) + 1;
        uint256 round_ = block.chainid == 1 ? currentRound + 4 : currentRound + 1;
        return abi.encode(round_, abi.encode(requestId, bytes("")));
    }
}
