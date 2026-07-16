// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IReputationRegistry {
    function attest(address member, uint256 roundCount) external;
}
