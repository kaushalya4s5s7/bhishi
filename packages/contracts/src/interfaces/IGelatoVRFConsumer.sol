// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IGelatoVRFConsumer {
    function fulfillRandomness(uint256 requestId, uint256 randomness, bytes calldata extraData) external;
}
