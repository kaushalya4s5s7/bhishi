// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Circle} from "../../src/Circle.sol";

contract MockVRF {
    function fulfill(address circle, uint256 requestId, uint256 randomness) external {
        Circle(circle).fulfillRandomness(requestId, randomness, "");
    }
}
