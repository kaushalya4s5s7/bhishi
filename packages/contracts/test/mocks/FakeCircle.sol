// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IReputationRegistry} from "../../src/interfaces/IReputationRegistry.sol";

/// @notice A contract that pretends to be a circle but is NOT registered with
///         the factory. Used in LEAK 4 tests to prove the registry rejects it.
contract FakeCircle {
    IReputationRegistry public immutable rep;

    constructor(address _rep) {
        rep = IReputationRegistry(_rep);
    }

    function tryAttest(address member, uint256 count) external {
        rep.attest(member, count);
    }
}
