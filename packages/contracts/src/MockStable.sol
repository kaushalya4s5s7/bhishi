// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockStable
/// @notice Faucet-enabled mock stablecoin (6 decimals) for Bhishi testnet use.
contract MockStable is ERC20 {
    /// @notice Amount minted per faucet call (500 mUSDC at 6 decimals).
    uint256 public constant FAUCET_AMOUNT = 500 * 1e6;

    /// @notice Minimum time between faucet claims per address.
    uint256 public constant FAUCET_COOLDOWN = 1 days;

    /// @notice Timestamp of the last successful faucet claim per address.
    mapping(address => uint256) public lastFaucet;

    /// @notice Reverts when faucet is called again before the cooldown elapses.
    error FaucetCooldown();

    constructor() ERC20("Mock USDC", "mUSDC") {}

    /// @notice ERC-20 decimals overridden to 6 to match real USDC.
    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Mints FAUCET_AMOUNT to the caller, enforcing a per-address cooldown.
    function faucet() external {
        uint256 last = lastFaucet[msg.sender];
        if (last != 0 && block.timestamp < last + FAUCET_COOLDOWN) {
            revert FaucetCooldown();
        }
        lastFaucet[msg.sender] = block.timestamp;
        _mint(msg.sender, FAUCET_AMOUNT);
    }
}
