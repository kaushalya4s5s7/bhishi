// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IReputationRegistry} from "./interfaces/IReputationRegistry.sol";
import {Circle} from "./Circle.sol";

interface ICircleFactory {
    function isCircle(address) external view returns (bool);
}

/// @title ReputationRegistry
/// @notice Factory-gated attestation registry. Only circles deployed by the
///         canonical factory can write attestations, and only when COMPLETED.
///         Proves LEAK 4: fake circles cannot inflate reputation scores.
contract ReputationRegistry is IReputationRegistry {
    error NotFactoryCircle();
    error AlreadyAttested();

    /// @notice Attestation count (circle completions) per member address.
    mapping(address => uint256) public score;
    /// @notice Deduplication guard: circle → member → already attested.
    mapping(address => mapping(address => bool)) public hasAttested;

    address public immutable factory;

    event Attested(address indexed circle, address indexed member, uint256 newScore);

    constructor(address _factory) {
        factory = _factory;
    }

    /// @inheritdoc IReputationRegistry
    function attest(address member, uint256 /*roundCount*/) external override {
        // Gate 1: caller must be a circle registered by the factory
        if (!ICircleFactory(factory).isCircle(msg.sender)) revert NotFactoryCircle();
        // Gate 2: the calling circle must be in COMPLETED state
        if (Circle(payable(msg.sender)).state() != Circle.State.COMPLETED) revert NotFactoryCircle();
        // Gate 3: each (circle, member) pair may only attest once
        if (hasAttested[msg.sender][member]) revert AlreadyAttested();
        hasAttested[msg.sender][member] = true;

        score[member] += 1;
        emit Attested(msg.sender, member, score[member]);
    }
}
