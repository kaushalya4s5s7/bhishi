// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice ERC20 token that attempts a reentrancy attack on `transfer`.
///         When `attacking` is true, transfer calls `target.claim()` before
///         delegating to the normal ERC20 transfer. The nonReentrant guard on
///         Circle.claim() must block the nested call.
contract ReentrantToken is ERC20 {
    address public target;
    bool    public attacking;

    constructor() ERC20("ReentrantToken", "RT") {
        _mint(msg.sender, 1_000_000e6);
    }

    function setTarget(address _target) external {
        target = _target;
    }

    function setAttacking(bool _attacking) external {
        attacking = _attacking;
    }

    /// @dev Override transfer: if attacking, re-enter Circle.claim() then proceed
    ///      with the normal transfer so the outer call does not silently fail.
    function transfer(address to, uint256 amount) public override returns (bool) {
        if (attacking && target != address(0)) {
            attacking = false; // prevent infinite loop
            // solhint-disable-next-line avoid-low-level-calls
            target.call(abi.encodeWithSignature("claim()"));
            // We intentionally ignore the return value; the nested revert is what
            // we are testing (via vm.expectRevert on the outer call in the test).
        }
        return super.transfer(to, amount);
    }
}
