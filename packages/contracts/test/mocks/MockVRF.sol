// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Circle} from "../../src/Circle.sol";

/// @notice Stands in for Gelato's VRF node in tests.
///
///         Gelato answers a RequestedRandomness event by calling
///         fulfillRandomness(randomness, dataWithRound), where dataWithRound is
///         the exact payload echoed back from the request:
///           abi.encode(round, abi.encode(requestId, extraData))
///         GelatoVRFConsumerBase re-hashes that payload and ignores any
///         mismatch, so this mock must reconstruct it precisely rather than
///         pass arbitrary bytes.
///
///         Deploy this mock AS the circle's operator (pass its address as the
///         factory's vrfOperator) so its calls satisfy the base's check.
contract MockVRF {
    /// Mirrors GelatoVRFConsumerBase's private _round() for an arbitrary timestamp.
    function roundAt(uint256 ts) public view returns (uint256 r) {
        uint256 elapsedFromGenesis = ts - 1692803367;
        uint256 currentRound = (elapsedFromGenesis / 3) + 1;
        r = block.chainid == 1 ? currentRound + 4 : currentRound + 1;
    }

    /// The round for the CURRENT block — correct only when no time has passed
    /// since the request.
    function round() public view returns (uint256 r) {
        r = roundAt(block.timestamp);
    }

    /// Rebuild the dataWithRound payload for a given requestId at an explicit round.
    function payloadAt(uint256 r, uint256 requestId) public pure returns (bytes memory) {
        return abi.encode(r, abi.encode(requestId, bytes("")));
    }

    /// Rebuild the dataWithRound payload for a given requestId at the current round.
    function payload(uint256 requestId) public view returns (bytes memory) {
        return payloadAt(round(), requestId);
    }

    /// @notice The round the consumer stored at REQUEST time.
    ///
    ///         _round() is a pure function of block.timestamp, so if a test warps
    ///         between requestDraw() and fulfilment the CURRENT round no longer
    ///         matches the stored one — and the base SILENTLY no-ops on a hash
    ///         mismatch (no revert, no draw), which surfaces as a baffling
    ///         assertion failure. Circle.requestDraw records block.timestamp in
    ///         drawRequestedAt, which is exactly the timestamp _round() consumed,
    ///         so we can recover the request-time round in O(1).
    function roundFor(address circle, uint256) public view returns (uint256 r) {
        r = roundAt(Circle(circle).drawRequestedAt());
    }

    /// @param requestId The consumer's request id (its first request is 0).
    function fulfill(address circle, uint256 requestId, uint256 randomness) external {
        uint256 r = roundFor(circle, requestId);
        bytes memory data = payloadAt(r, requestId);
        // Fail loudly instead of letting the base silently no-op on a mismatch.
        require(
            keccak256(data) == Circle(circle).requestedHash(requestId),
            "MockVRF: payload does not match the consumer's stored request hash"
        );
        Circle(circle).fulfillRandomness(randomness, data);
    }
}
