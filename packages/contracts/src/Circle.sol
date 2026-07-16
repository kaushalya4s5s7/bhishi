// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Distribution mechanism for a circle's pot each round.
enum Mode {
    LUCKY_DRAW,
    AUCTION
}

/// @title Circle
/// @notice Clone-safe ROSCA circle. Deployed once as an implementation and
///         cloned per-circle by CircleFactory. This milestone (M3) implements
///         the FILLING -> ACTIVE join flow and the permissionless
///         FILLING_TIMEOUT refund (LEAK 6). Round/VRF/payout FSM lands in M4+.
contract Circle is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // --- errors ---
    error AlreadyInitialized();
    error InvalidSeats();
    error NotFilling();
    error AlreadyJoined();
    error FillingNotTimedOut();

    /// @notice Lifecycle states. Only FILLING/ACTIVE/ABORTED_FILLING transitions
    ///         are implemented in M3; later states are reserved for M4+.
    enum State {
        FILLING,
        ACTIVE,
        ABORTED_FILLING
    }

    /// @notice Per-member accounting.
    struct Member {
        bool joined; // seat taken
        uint256 stakedBond; // collateral posted (slashable in later milestones)
        uint256 contribution; // current-round contribution held by the circle
        uint256 claimable; // funds owed back to the member (reserved for M4+)
    }

    /// @notice Window a circle may sit in FILLING before it can be refunded.
    uint256 public constant FILLING_TIMEOUT = 3 days;

    // --- immutable-per-clone config (set once in initialize) ---
    uint256 public contribution;
    uint256 public seats;
    uint256 public bond;
    Mode public mode;
    address public stable;
    address public factory;
    address public reputation;

    // --- lifecycle ---
    bool public initialized;
    State public state;
    uint256 public startedAt; // timestamp FILLING began

    // --- membership ---
    address[] public members;
    mapping(address => Member) public memberInfo;

    event Joined(address indexed member, uint256 seat);
    event Activated();
    event FillingRefunded(uint256 memberCount);

    /// @dev Lock the implementation so only clones (whose storage starts zeroed)
    ///      can ever be initialized.
    constructor() {
        initialized = true;
    }

    /// @notice One-time initializer for a freshly created clone.
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
        if (_seats < 2) revert InvalidSeats();
        initialized = true;

        contribution = _contribution;
        seats = _seats;
        bond = _bond;
        mode = _mode;
        stable = _stable;
        factory = _factory;
        reputation = _reputation;

        state = State.FILLING;
        startedAt = block.timestamp;
    }

    /// @notice Number of members that have joined so far.
    function memberCount() external view returns (uint256) {
        return members.length;
    }

    /// @notice Join the circle by posting bond + first-round contribution.
    /// @dev Only in FILLING; one seat per address. Fills the last seat -> ACTIVE.
    function join() external nonReentrant {
        if (state != State.FILLING) revert NotFilling();
        if (memberInfo[msg.sender].joined) revert AlreadyJoined();

        uint256 stake = bond + contribution;

        Member storage m = memberInfo[msg.sender];
        m.joined = true;
        m.stakedBond = bond;
        m.contribution = contribution;
        members.push(msg.sender);

        emit Joined(msg.sender, members.length - 1);

        if (members.length == seats) {
            state = State.ACTIVE;
            emit Activated();
        }

        IERC20(stable).safeTransferFrom(msg.sender, address(this), stake);
    }

    /// @notice Permissionless refund if the circle never filled in time (LEAK 6).
    /// @dev Returns each joiner exactly bond + contribution, then aborts filling.
    function refundFilling() external nonReentrant {
        if (state != State.FILLING) revert NotFilling();
        if (block.timestamp < startedAt + FILLING_TIMEOUT) revert FillingNotTimedOut();

        // CEI: flip state before external transfers.
        state = State.ABORTED_FILLING;

        uint256 n = members.length;
        IERC20 token = IERC20(stable);
        for (uint256 i = 0; i < n; i++) {
            address m = members[i];
            Member storage info = memberInfo[m];
            uint256 amount = info.stakedBond + info.contribution;
            info.stakedBond = 0;
            info.contribution = 0;
            token.safeTransfer(m, amount);
        }

        emit FillingRefunded(n);
    }
}
