// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IEntropyV2} from "../../src/vendor/pyth/IEntropyV2.sol";
import {IEntropyConsumer} from "../../src/vendor/pyth/IEntropyConsumer.sol";
import {EntropyStructsV2} from "../../src/vendor/pyth/EntropyStructsV2.sol";

/// @notice Stands in for Pyth's Entropy contract in tests.
///
///         Pyth's own SDK MockEntropy hardcodes getFeeV2() == 0, which cannot
///         exercise the fee-sponsorship model (an unfunded circle would never
///         hit InsufficientVrfFunding, and "the circle paid, not the member"
///         would be unobservable). This mock takes a configurable fee, requires
///         it as msg.value on requestV2 exactly as the real contract does, and
///         hands out incrementing sequence numbers.
///
///         Deploy it AS the circle's entropy contract (pass its address as the
///         factory's `entropy`) so its callbacks satisfy IEntropyConsumer's
///         msg.sender == getEntropy() check.
contract MockEntropy is IEntropyV2 {
    address public provider;
    uint128 public fee;
    uint64 public nextSequenceNumber = 1;

    /// requester of each issued sequence number
    mapping(uint64 => address) public requesterOf;

    error InsufficientFee();

    constructor(uint128 _fee) {
        provider = address(uint160(uint256(keccak256("mock-provider"))));
        fee = _fee;
    }

    function setFee(uint128 _fee) external {
        fee = _fee;
    }

    // ─── request path ──────────────────────────────────────────────────────────

    function requestV2() external payable returns (uint64) {
        return _request();
    }

    function requestV2(uint32) external payable returns (uint64) {
        return _request();
    }

    function requestV2(address, uint32) external payable returns (uint64) {
        return _request();
    }

    function requestV2(address, bytes32, uint32) external payable returns (uint64) {
        return _request();
    }

    function _request() internal returns (uint64 seq) {
        // Mirror the real contract: revert unless a sufficient fee is provided.
        if (msg.value < fee) revert InsufficientFee();
        seq = nextSequenceNumber++;
        requesterOf[seq] = msg.sender;
    }

    // ─── reveal path ───────────────────────────────────────────────────────────

    /// @notice Deliver randomness to a consumer, exactly as the keeper would.
    function fulfill(address consumer, uint64 seq, bytes32 randomNumber) external {
        IEntropyConsumer(consumer)._entropyCallback(seq, provider, randomNumber);
    }

    /// @notice Deliver randomness for the sequence number issued to `consumer`.
    function fulfillLatest(address consumer, uint256 randomness) external {
        uint64 seq = nextSequenceNumber - 1;
        require(requesterOf[seq] == consumer, "MockEntropy: no pending request for consumer");
        IEntropyConsumer(consumer)._entropyCallback(seq, provider, bytes32(randomness));
    }

    // ─── views ─────────────────────────────────────────────────────────────────

    function getFeeV2() external view returns (uint128) {
        return fee;
    }

    function getFeeV2(uint32) external view returns (uint128) {
        return fee;
    }

    function getFeeV2(address, uint32) external view returns (uint128) {
        return fee;
    }

    function getDefaultProvider() external view returns (address) {
        return provider;
    }

    function getProviderInfoV2(address) external pure returns (EntropyStructsV2.ProviderInfo memory info) {
        return info;
    }

    function getRequestV2(address, uint64) external pure returns (EntropyStructsV2.Request memory req) {
        return req;
    }
}
