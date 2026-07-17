// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Circle, Mode} from "./Circle.sol";
import {IEntropyV2} from "./vendor/pyth/IEntropyV2.sol";

/// @title CircleFactory
/// @notice Deploys Circle clones, enforces the bond-sizing gate at creation
///         (LEAK 2), and maintains the canonical isCircle registry (LEAK 4).
///         Clones give each circle isolated storage (LEAK 5).
contract CircleFactory {
    error BondTooLow();
    error VrfFundingFailed();

    /// @notice The Circle implementation cloned for every new circle.
    address public immutable implementation;
    /// @notice Stable ERC20 token used across all circles.
    address public immutable stable;
    /// @notice Reputation registry passed to circles (may be address(0) for now).
    address public immutable reputation;
    /// @notice Pyth Entropy contract threaded into every circle this factory
    ///         creates. Set once at deploy; only this address can deliver a
    ///         draw callback. address(0) leaves circles permissionless —
    ///         acceptable only for local/dev and the demo scripts, never for a
    ///         deployment holding real value.
    address public immutable entropy;

    /// @notice Canonical registry of factory-deployed circles.
    mapping(address => bool) public isCircle;

    event CircleCreated(
        address indexed circle,
        address indexed creator,
        uint256 contribution,
        uint256 seats,
        uint256 bond,
        Mode mode
    );

    constructor(address _implementation, address _stable, address _reputation, address _entropy) {
        implementation = _implementation;
        stable = _stable;
        reputation = _reputation;
        entropy = _entropy;
    }

    /// @notice Deploy and register a new circle clone.
    /// @dev Reverts BondTooLow if bond cannot cover the worst-case default
    ///      exposure of (seats-1)*contribution.
    ///      Payable: any msg.value is forwarded to the clone to sponsor its
    ///      Entropy fees, so a creator can fund the circle's draws in the same
    ///      tx and members never pay native MON for randomness.
    function createCircle(uint256 contribution, uint256 seats, uint256 bond, Mode mode)
        external
        payable
        returns (address circle)
    {
        if (bond < (seats - 1) * contribution) revert BondTooLow();

        circle = Clones.clone(implementation);
        Circle(payable(circle)).initialize(
            contribution, seats, bond, mode, stable, address(this), reputation, entropy, msg.sender
        );
        isCircle[circle] = true;

        if (msg.value > 0) {
            (bool ok, ) = circle.call{value: msg.value}("");
            if (!ok) revert VrfFundingFailed();
        }

        emit CircleCreated(circle, msg.sender, contribution, seats, bond, mode);
    }

    /// @notice Quote the MON needed to sponsor `seats` draws (one per round).
    ///         Returns 0 in permissionless/test mode (entropy unset).
    function vrfFundingFor(uint256 seats) external view returns (uint256) {
        if (entropy == address(0)) return 0;
        return uint256(IEntropyV2(entropy).getFeeV2()) * seats;
    }
}
