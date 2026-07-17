// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Shared VRF test constants.
///
///         VRF_FEE mirrors the real Pyth Entropy fee on Monad testnet
///         (~0.126 MON, flat regardless of gas limit) so tests exercise a
///         non-zero, realistic sponsorship cost rather than a free draw.
///         VRF_BUDGET funds a circle for many rounds in one go.
abstract contract VrfFixture {
    uint128 internal constant VRF_FEE = 126202500000000001;
    uint256 internal constant VRF_BUDGET = VRF_FEE * 64;
}
