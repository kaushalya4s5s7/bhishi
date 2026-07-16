// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Circle, Mode} from "./Circle.sol";

/// @title CircleFactory
/// @notice Deploys Circle clones, enforces the bond-sizing gate at creation
///         (LEAK 2), and maintains the canonical isCircle registry (LEAK 4).
///         Clones give each circle isolated storage (LEAK 5).
contract CircleFactory {
    error BondTooLow();

    /// @notice The Circle implementation cloned for every new circle.
    address public immutable implementation;
    /// @notice Stable ERC20 token used across all circles.
    address public immutable stable;
    /// @notice Reputation registry passed to circles (may be address(0) for now).
    address public immutable reputation;

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

    constructor(address _implementation, address _stable, address _reputation) {
        implementation = _implementation;
        stable = _stable;
        reputation = _reputation;
    }

    /// @notice Deploy and register a new circle clone.
    /// @dev Reverts BondTooLow if bond cannot cover the worst-case default
    ///      exposure of (seats-1)*contribution.
    function createCircle(uint256 contribution, uint256 seats, uint256 bond, Mode mode)
        external
        returns (address circle)
    {
        if (bond < (seats - 1) * contribution) revert BondTooLow();

        circle = Clones.clone(implementation);
        Circle(circle).initialize(contribution, seats, bond, mode, stable, address(this), reputation, address(0));
        isCircle[circle] = true;

        emit CircleCreated(circle, msg.sender, contribution, seats, bond, mode);
    }
}
