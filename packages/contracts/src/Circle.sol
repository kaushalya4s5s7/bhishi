// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Distribution mechanism for a circle's pot each round.
enum Mode {
    LUCKY_DRAW,
    AUCTION
}

/// @title Circle
/// @notice Minimal clone-safe base for a ROSCA circle. Deployed once as an
///         implementation and cloned per-circle by CircleFactory. Later
///         milestones (M3+) add the join/FSM/VRF logic; this stub only stores
///         initialization params and guards against re-initialization.
contract Circle {
    error AlreadyInitialized();

    // --- immutable-per-clone config (set once in initialize) ---
    uint256 public contribution;
    uint256 public seats;
    uint256 public bond;
    Mode public mode;
    address public stable;
    address public factory;
    address public reputation;

    bool public initialized;

    /// @notice One-time initializer for a freshly created clone.
    /// @param _contribution per-round contribution amount (stable token units)
    /// @param _seats        number of seats/participants in the circle
    /// @param _bond         collateral bond each member must post
    /// @param _mode         pot distribution mode
    /// @param _stable       stable ERC20 token used for contributions/bonds
    /// @param _factory      the CircleFactory that created this clone
    /// @param _reputation   reputation registry (may be address(0) for now)
    function initialize(
        uint256 _contribution,
        uint256 _seats,
        uint256 _bond,
        Mode _mode,
        address _stable,
        address _factory,
        address _reputation
    ) external {
        if (initialized) revert AlreadyInitialized();
        initialized = true;

        contribution = _contribution;
        seats = _seats;
        bond = _bond;
        mode = _mode;
        stable = _stable;
        factory = _factory;
        reputation = _reputation;
    }
}
