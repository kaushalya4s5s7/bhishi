// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {Circle, Mode} from "../src/Circle.sol";
import {CircleFactory} from "../src/CircleFactory.sol";
import {MockStable} from "../src/MockStable.sol";

/// @notice Drives ONE round of a circle against REAL Pyth Entropy on Monad
///         testnet, in small steps so each can be run separately.
///
///         With a real Entropy address wired in, this script CANNOT fulfil the
///         draw itself — the SDK enforces `msg.sender == entropy`, so only
///         Pyth's keeper may deliver randomness. That's the whole point: the
///         winner is drawn from drand, not chosen by us. So the flow is
///         request-then-wait, not request-then-self-fulfil.
///
///         Deliberately minimal to conserve testnet MON: 2 seats (the contract
///         minimum) = 2 rounds = 2 draws = ~0.25 MON of Entropy fees per circle.
///         Unspent VRF funding refunds to the creator on completion.
///
///         Env: PRIVATE_KEY, FACTORY, STABLE, MODE (0=LUCKY_DRAW, 1=AUCTION),
///              CIRCLE (for the step actions).
contract PythLifecycle is Script {
    uint256 constant CONTRIB = 1e6;  // 1 mUSDC — keep stake tiny
    uint256 constant SEATS   = 2;    // contract minimum: fewest draws = least MON
    uint256 constant BOND    = (SEATS - 1) * CONTRIB;

    uint256 dk;
    uint256[2] mkeys;
    address[2] members;

    function _init() internal returns (address deployer) {
        dk = vm.envUint("PRIVATE_KEY");
        deployer = vm.addr(dk);
        for (uint256 i = 0; i < SEATS; i++) {
            mkeys[i]   = uint256(keccak256(abi.encodePacked("bhishi-pyth-v1", i, deployer)));
            members[i] = vm.addr(mkeys[i]);
        }
    }

    /// Step 1: create a circle, fund its Entropy fees, and fill every seat.
    function create() external {
        address deployer = _init();
        CircleFactory factory = CircleFactory(vm.envAddress("FACTORY"));
        MockStable stable = MockStable(vm.envAddress("STABLE"));
        Mode mode = Mode(vm.envUint("MODE"));

        uint256 funding = factory.vrfFundingFor(SEATS);
        console.log("VRF funding for", SEATS, "draws (wei):", funding);

        // The circle sponsors every Entropy fee from its own balance, so members
        // never spend native MON. Fund it all in the create tx.
        vm.broadcast(dk);
        address c = factory.createCircle{value: funding}(CONTRIB, SEATS, BOND, mode);
        console.log("CIRCLE:", c);

        Circle circle = Circle(payable(c));

        // Each redeploy mints a fresh MockStable, so the deployer starts with 0
        // mUSDC on it. Faucet once (500 mUSDC), then share it out.
        if (stable.balanceOf(deployer) < SEATS * (BOND + SEATS * CONTRIB)) {
            vm.broadcast(dk);
            stable.faucet();
        }

        // Fund members with mUSDC + a little MON for their own gas, then join.
        for (uint256 i = 0; i < SEATS; i++) {
            vm.broadcast(dk);
            payable(members[i]).transfer(0.03 ether);

            vm.broadcast(dk);
            stable.transfer(members[i], BOND + SEATS * CONTRIB);

            vm.startBroadcast(mkeys[i]);
            stable.approve(c, type(uint256).max);
            circle.join();
            vm.stopBroadcast();
        }
        console.log("state after joins (3=COMMIT):", uint256(circle.state()));
        console.log("circle MON balance (wei):", c.balance);
    }

    /// Step 2: commit + reveal everyone, then REQUEST the draw. Pyth's keeper
    ///         fulfils it asynchronously — this script stops at the request.
    function playRound() external {
        _init();
        Circle circle = Circle(payable(vm.envAddress("CIRCLE")));
        uint256 r = circle.currentRound();
        bytes32 salt = keccak256(abi.encodePacked("pyth-salt", r));
        Mode mode = circle.mode();

        for (uint256 i = 0; i < SEATS; i++) {
            if (mode == Mode.AUCTION && circle.hasWon(members[i])) continue; // auto-advanced
            // LUCKY_DRAW reveals the contribution; AUCTION reveals a bid discount.
            uint256 amount = mode == Mode.LUCKY_DRAW ? CONTRIB : (i * CONTRIB) / 10;
            vm.broadcast(mkeys[i]);
            circle.commit(keccak256(abi.encodePacked(amount, salt, members[i])));
        }

        vm.broadcast(dk);
        circle.advanceToReveal();

        for (uint256 i = 0; i < SEATS; i++) {
            if (mode == Mode.AUCTION && circle.hasWon(members[i])) continue;
            uint256 amount = mode == Mode.LUCKY_DRAW ? CONTRIB : (i * CONTRIB) / 10;
            vm.broadcast(mkeys[i]);
            circle.reveal(amount, salt);
        }

        // This emits Pyth's Requested event and pays the fee from the CIRCLE's
        // balance. Pyth's keeper answers it within seconds — we cannot.
        vm.broadcast(dk);
        circle.requestDraw();

        console.log("draw requested for round", r);
        console.log("pyth sequence number:", circle.vrfSequenceNumber());
        console.log("waiting on Pyth's keeper to fulfil...");
    }

    /// Step 3: read-only status check.
    function status() external {
        _init();
        Circle circle = Circle(payable(vm.envAddress("CIRCLE")));
        console.log("state:", uint256(circle.state()));
        console.log("round:", circle.currentRound());
        for (uint256 i = 0; i < SEATS; i++) {
            console.log("member", i);
            console.log("   hasWon:", circle.hasWon(members[i]));
        }
    }
}
