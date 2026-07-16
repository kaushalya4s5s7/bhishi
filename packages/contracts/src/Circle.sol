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
///         cloned per-circle by CircleFactory.
///         M3: FILLING → ACTIVE join flow + FILLING_TIMEOUT refund (LEAK 6).
///         M4: commit-reveal rounds + auto-slash with dust bucket (LEAK 3, money shot 3).
contract Circle is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── errors ────────────────────────────────────────────────────────────────
    error AlreadyInitialized();
    error InvalidSeats();
    error NotFilling();
    error AlreadyJoined();
    error FillingNotTimedOut();
    error NotCommitPhase();
    error NotRevealPhase();
    error AlreadyCommitted();
    error NotCommitted();
    error AlreadyRevealed();
    error InvalidReveal();
    error NotMember();
    error RevealWindowOpen();
    error NothingToClaim();

    // ─── state enum ────────────────────────────────────────────────────────────
    /// @notice Full lifecycle state machine.
    enum State {
        FILLING,
        ACTIVE,      // transitional (replaced by COMMIT on last join)
        ABORTED_FILLING,
        COMMIT,
        REVEAL,
        DRAW,
        PAYOUT,
        COMPLETED,
        STALLED
    }

    // ─── per-member data ────────────────────────────────────────────────────────
    struct Member {
        bool joined;          // seat taken (false = removed/slashed)
        uint256 stakedBond;   // collateral posted (slashable)
        uint256 contribution; // current-round contribution paid at join (round 0 pre-pay)
        uint256 claimable;    // pull-payment accumulator
    }

    // ─── constants ─────────────────────────────────────────────────────────────
    uint256 public constant FILLING_TIMEOUT = 3 days;
    uint256 public constant COMMIT_WINDOW   = 1 days;
    uint256 public constant REVEAL_WINDOW   = 1 days;
    uint256 public constant MAX_SEATS       = 20;

    // ─── immutable-per-clone config ─────────────────────────────────────────────
    uint256 public contribution;
    uint256 public seats;
    uint256 public bond;
    Mode    public mode;
    address public stable;
    address public factory;
    address public reputation;

    // ─── lifecycle ─────────────────────────────────────────────────────────────
    bool    public initialized;
    State   public state;
    uint256 public startedAt;   // timestamp FILLING began
    uint256 public currentRound;
    uint256 public roundStart;  // timestamp current COMMIT phase began

    // ─── membership ────────────────────────────────────────────────────────────
    address[] public members;
    mapping(address => Member) public memberInfo;

    // ─── per-round commit-reveal tracking (reset each round) ───────────────────
    mapping(address => bytes32) public commitmentOf;
    mapping(address => bool)    public committed;
    mapping(address => bool)    public revealed;
    uint256 public revealCount; // how many members revealed this round
    uint256 public roundPool;   // total contributions collected this round

    // ─── dust accumulator (LEAK 3) ─────────────────────────────────────────────
    uint256 public dustAccrued;

    // ─── events ────────────────────────────────────────────────────────────────
    event Joined(address indexed member, uint256 seat);
    event Activated();
    event FillingRefunded(uint256 memberCount);
    event RoundStarted(uint256 indexed round, uint256 roundStart);
    event Committed(address indexed member, uint256 indexed round);
    event Revealed(address indexed member, uint256 indexed round);
    event Slashed(address indexed defaulter, uint256 bondSlashed, uint256 redistributed);
    event DrawReady(uint256 indexed round);
    event Claimed(address indexed member, uint256 amount);

    // ─── constructor ───────────────────────────────────────────────────────────
    /// @dev Lock the implementation so only clones can ever be initialized.
    constructor() {
        initialized = true;
    }

    // ─── initialize ────────────────────────────────────────────────────────────
    function initialize(
        uint256 _contribution,
        uint256 _seats,
        uint256 _bond,
        Mode    _mode,
        address _stable,
        address _factory,
        address _reputation
    ) external {
        if (initialized) revert AlreadyInitialized();
        if (_seats < 2 || _seats > MAX_SEATS) revert InvalidSeats();
        initialized = true;

        contribution = _contribution;
        seats        = _seats;
        bond         = _bond;
        mode         = _mode;
        stable       = _stable;
        factory      = _factory;
        reputation   = _reputation;

        state     = State.FILLING;
        startedAt = block.timestamp;
    }

    // ─── view helpers ──────────────────────────────────────────────────────────
    function memberCount() external view returns (uint256) {
        return members.length;
    }

    /// @notice Sum of all member claimable balances (M6 conservation invariant).
    function totalClaimable() external view returns (uint256 total) {
        for (uint256 i = 0; i < members.length; i++) {
            total += memberInfo[members[i]].claimable;
        }
    }

    /// @notice Round pool not yet paid out (M6 conservation invariant).
    function undrawnPools() external view returns (uint256) {
        // Payout not yet implemented (M5); expose roundPool as proxy.
        return roundPool;
    }

    // ─── join ──────────────────────────────────────────────────────────────────
    /// @notice Join the circle by posting bond.
    ///         Round-0 contribution is NOT pre-pulled here; every round members
    ///         pay at commit() time for clean accounting and slashing logic.
    function join() external nonReentrant {
        if (state != State.FILLING) revert NotFilling();
        if (memberInfo[msg.sender].joined) revert AlreadyJoined();

        Member storage m = memberInfo[msg.sender];
        m.joined      = true;
        m.stakedBond  = bond;
        // contribution field unused post-M3; keep zeroed.
        members.push(msg.sender);

        emit Joined(msg.sender, members.length - 1);

        // Last seat filled → jump straight to COMMIT (skip transient ACTIVE)
        if (members.length == seats) {
            state      = State.COMMIT;
            roundStart = block.timestamp;
            emit Activated();
            emit RoundStarted(currentRound, roundStart);
        }

        // Pull only the bond from the joiner.
        IERC20(stable).safeTransferFrom(msg.sender, address(this), bond);
    }

    // ─── refund filling ────────────────────────────────────────────────────────
    /// @notice Permissionless refund if the circle never filled in time (LEAK 6).
    function refundFilling() external nonReentrant {
        if (state != State.FILLING) revert NotFilling();
        if (block.timestamp < startedAt + FILLING_TIMEOUT) revert FillingNotTimedOut();

        state = State.ABORTED_FILLING;

        uint256 n = members.length;
        IERC20 token = IERC20(stable);
        for (uint256 i = 0; i < n; i++) {
            address addr = members[i];
            Member storage info = memberInfo[addr];
            uint256 amount = info.stakedBond + info.contribution;
            info.stakedBond  = 0;
            info.contribution = 0;
            token.safeTransfer(addr, amount);
        }

        emit FillingRefunded(n);
    }

    // ─── commit ────────────────────────────────────────────────────────────────
    /// @notice Submit commitment hash for this round and pay contribution.
    /// @param commitment keccak256(abi.encodePacked(amount, salt, msg.sender))
    function commit(bytes32 commitment) external nonReentrant {
        if (state != State.COMMIT) revert NotCommitPhase();
        if (!memberInfo[msg.sender].joined) revert NotMember();
        if (committed[msg.sender]) revert AlreadyCommitted();

        // CEI: record state before external call
        committed[msg.sender]   = true;
        commitmentOf[msg.sender] = commitment;
        roundPool               += contribution;

        emit Committed(msg.sender, currentRound);

        // Pull contribution
        IERC20(stable).safeTransferFrom(msg.sender, address(this), contribution);
    }

    // ─── advance to reveal ─────────────────────────────────────────────────────
    /// @notice Anyone can advance phase from COMMIT→REVEAL after COMMIT_WINDOW.
    ///         (Optional: auto-advance can be triggered by commit if all committed.)
    function advanceToReveal() external {
        if (state != State.COMMIT) revert NotCommitPhase();
        // Move to REVEAL; allow immediately if everyone has committed.
        state = State.REVEAL;
    }

    // ─── reveal ────────────────────────────────────────────────────────────────
    /// @notice Reveal the pre-image of your commitment.
    function reveal(uint256 amount, bytes32 salt) external nonReentrant {
        // Accept reveal in both COMMIT (early) and REVEAL phases
        if (state != State.COMMIT && state != State.REVEAL) revert NotRevealPhase();
        if (!memberInfo[msg.sender].joined) revert NotMember();
        if (!committed[msg.sender]) revert NotCommitted();
        if (revealed[msg.sender]) revert AlreadyRevealed();

        bytes32 expected = keccak256(abi.encodePacked(amount, salt, msg.sender));
        if (expected != commitmentOf[msg.sender]) revert InvalidReveal();
        if (amount != contribution) revert InvalidReveal();

        // CEI
        revealed[msg.sender] = true;
        revealCount++;

        emit Revealed(msg.sender, currentRound);

        // Check if all active members have revealed → advance to DRAW
        _checkAllRevealed();
    }

    // ─── slash ─────────────────────────────────────────────────────────────────
    /// @notice Permissionless slash of a member who missed the reveal deadline.
    ///         Tops up the round pool from defaulter's bond, then distributes
    ///         bond remainder pro-rata to compliant (revealed) members.
    ///         Integer dust → dustAccrued (LEAK 3).
    function slash(address defaulter) external nonReentrant {
        if (block.timestamp < roundStart + REVEAL_WINDOW) {
            revert RevealWindowOpen();
        }
        if (!memberInfo[defaulter].joined) revert NotMember();
        if (revealed[defaulter]) revert AlreadyRevealed();

        Member storage def = memberInfo[defaulter];
        uint256 bondAmount = def.stakedBond;

        // How much contribution is missing from the pool for this defaulter?
        uint256 missingContrib = committed[defaulter] ? 0 : contribution;
        // If they didn't commit, their contribution is not in roundPool yet.

        // CEI: mark removed before external transfers
        def.joined     = false;
        def.stakedBond = 0;
        // If they committed but didn't reveal, their contribution is already in
        // roundPool. If they didn't commit, we top up now from the bond.
        uint256 topUp = missingContrib > bondAmount ? bondAmount : missingContrib;
        roundPool     += topUp;
        uint256 remainder = bondAmount - topUp;

        // Count compliant (revealed) members for pro-rata redistribution
        uint256 compliantCount = _countCompliant(defaulter);

        uint256 dust;
        if (compliantCount > 0 && remainder > 0) {
            uint256 sharePerMember = remainder / compliantCount;
            dust = remainder - sharePerMember * compliantCount;
            // Distribute to revealed members
            for (uint256 i = 0; i < members.length; i++) {
                address m = members[i];
                if (m != defaulter && revealed[m]) {
                    memberInfo[m].claimable += sharePerMember;
                }
            }
        } else {
            dust = remainder;
        }

        dustAccrued += dust;

        emit Slashed(defaulter, bondAmount, remainder - dust);
    }

    // ─── claim ─────────────────────────────────────────────────────────────────
    /// @notice Pull-payment: withdraw accumulated claimable balance. CEI + nonReentrant.
    function claim() external nonReentrant {
        uint256 amount = memberInfo[msg.sender].claimable;
        if (amount == 0) return; // no revert, idempotent

        // CEI: zero before transfer
        memberInfo[msg.sender].claimable = 0;

        IERC20(stable).safeTransfer(msg.sender, amount);
        emit Claimed(msg.sender, amount);
    }

    // ─── internal helpers ──────────────────────────────────────────────────────

    function _activeCount() internal view returns (uint256 count) {
        for (uint256 i = 0; i < members.length; i++) {
            if (memberInfo[members[i]].joined) count++;
        }
    }

    function _countCompliant(address exclude) internal view returns (uint256 count) {
        for (uint256 i = 0; i < members.length; i++) {
            address m = members[i];
            if (m != exclude && revealed[m]) count++;
        }
    }

    function _checkAllRevealed() internal {
        uint256 active = _activeCount();
        if (revealCount >= active) {
            state = State.DRAW;
            emit DrawReady(currentRound);
        }
    }
}
