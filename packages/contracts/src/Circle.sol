// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IEntropyConsumer} from "./vendor/pyth/IEntropyConsumer.sol";
import {IEntropyV2} from "./vendor/pyth/IEntropyV2.sol";
import {IReputationRegistry} from "./interfaces/IReputationRegistry.sol";

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
contract Circle is ReentrancyGuard, IEntropyConsumer {
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
    error CommitPhaseNotComplete();
    error NotDrawPhase();
    error DrawNotRequested();
    error VrfTimeoutNotElapsed();
    error DrawAlreadyRequested();
    error BidExceedsCap();
    error InsufficientVrfFunding();

    // ─── state enum ────────────────────────────────────────────────────────────
    /// @notice Full lifecycle state machine.
    enum State {
        FILLING,
        ACTIVE,      // reserved for future use
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
    uint256 public constant VRF_TIMEOUT     = 1 days;
    uint256 public constant MAX_BID_DISCOUNT_BPS = 4000; // 40% of round pool, matches real-world chit-fund convention

    // ─── immutable-per-clone config ─────────────────────────────────────────────
    uint256 public contribution;
    uint256 public seats;
    uint256 public bond;
    Mode    public mode;
    address public stable;
    address public factory;
    address public reputation;

    // ─── VRF (Pyth Entropy) ───────────────────────────────────────────────────
    /// @notice Pyth Entropy contract. address(0) = permissionless/test mode:
    ///         requestDraw() skips the Entropy call entirely and the draw is
    ///         driven by a direct callback (local tests + demo scripts).
    address public entropyContract;
    /// @notice The circle's creator — leftover VRF funding is refunded here.
    address public creator;
    /// @notice Sequence number of the in-flight Entropy request; the callback
    ///         must match it or it is ignored.
    uint64  public vrfSequenceNumber;
    uint256 public drawRequestedAt;   // timestamp of requestDraw() call; 0 = not pending
    mapping(address => bool) public hasWon; // true once member received their payout round

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

    // ─── auction-mode bid tracking (reset each round) ──────────────────────────
    // Deliberately just the raw revealed bids — no incremental "highest so far"
    // tracker. The winner/tie set is recomputed by scanning bidDiscount[] at
    // draw time (entropyCallback), so there is exactly one place
    // that decides who's winning, not two trackers that could drift out of sync.
    mapping(address => uint256) public bidDiscount; // revealed bid, meaningful only in AUCTION mode

    // ─── dust accumulator (LEAK 3) ─────────────────────────────────────────────
    uint256 public dustAccrued;

    // ─── events ────────────────────────────────────────────────────────────────
    event Joined(address indexed member, uint256 seat);
    event Activated();
    event FillingRefunded(uint256 memberCount);
    event RoundStarted(uint256 indexed round, uint256 roundStart);
    event Committed(address indexed member, uint256 indexed round);
    event Revealed(address indexed member, uint256 indexed round, uint256 bid);
    event Slashed(address indexed defaulter, uint256 bondSlashed, uint256 redistributed);
    event DrawReady(uint256 indexed round);
    event Claimed(address indexed member, uint256 amount);
    event DrawRequested(uint256 indexed round, uint256 requestedAt);
    event WinnerDrawn(uint256 indexed round, address indexed winner, uint256 randomness);
    event Stalled(uint256 indexed round);
    event VrfFunded(address from, uint256 amount);
    event VrfRefunded(address to, uint256 amount, bool ok);

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
        address _reputation,
        address _entropy,
        address _creator
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
        reputation      = _reputation;
        entropyContract = _entropy;
        creator         = _creator;

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

    /// @notice Round pool not yet paid out (conservation invariant).
    function undrawnPools() external view returns (uint256) {
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

        // AUCTION past winners ("prized subscribers") keep PAYING every round
        // but can never bid or win again. They pay by committing here; they do
        // NOT reveal. Auto-mark them revealed with a zero bid so the
        // all-revealed gate isn't blocked waiting on a reveal they'll never send
        // and they can't be slashed for a missing reveal. Their `commitment`
        // value is irrelevant (never checked, since they skip reveal()).
        if (mode == Mode.AUCTION && hasWon[msg.sender]) {
            revealed[msg.sender]    = true;
            bidDiscount[msg.sender] = 0;
            revealCount++;
            emit Revealed(msg.sender, currentRound, 0);
        }

        emit Committed(msg.sender, currentRound);

        // Pull contribution
        IERC20(stable).safeTransferFrom(msg.sender, address(this), contribution);
    }

    // ─── advance to reveal ─────────────────────────────────────────────────────
    /// @notice Advance COMMIT→REVEAL once all active members have committed.
    ///         Permissionless: anyone can call once the condition is met.
    ///         Updates roundStart to now so the slash timer is measured from
    ///         the start of the REVEAL phase (not the COMMIT phase).
    function advanceToReveal() external {
        if (state != State.COMMIT) revert NotCommitPhase();
        // Guard: all active members must have committed before advancing.
        uint256 n = members.length;
        for (uint256 i = 0; i < n; i++) {
            address m = members[i];
            if (memberInfo[m].joined && !committed[m]) revert CommitPhaseNotComplete();
        }
        // Reset roundStart to now so REVEAL_WINDOW / slash timer runs from here.
        roundStart = block.timestamp;
        state = State.REVEAL;
    }

    // ─── reveal ────────────────────────────────────────────────────────────────
    /// @notice Reveal the pre-image of your commitment (REVEAL phase only).
    function reveal(uint256 amount, bytes32 salt) external nonReentrant {
        if (state != State.REVEAL) revert NotRevealPhase();
        if (!memberInfo[msg.sender].joined) revert NotMember();
        if (!committed[msg.sender]) revert NotCommitted();
        if (revealed[msg.sender]) revert AlreadyRevealed();
        // Past winners are auto-revealed at commit() and cannot bid; they must
        // never reach the bidding path. (Defensive: they're already revealed,
        // so the guard above also catches them.)
        if (mode == Mode.AUCTION && hasWon[msg.sender]) revert AlreadyRevealed();

        bytes32 expected = keccak256(abi.encodePacked(amount, salt, msg.sender));
        if (expected != commitmentOf[msg.sender]) revert InvalidReveal();

        if (mode == Mode.LUCKY_DRAW) {
            if (amount != contribution) revert InvalidReveal();
        } else {
            // AUCTION: `amount` is the bid discount, capped at 40% of this
            // round's pot. hasWon members should never reach here (they are
            // auto-marked revealed at round start).
            uint256 cap = (roundPool * MAX_BID_DISCOUNT_BPS) / 10000;
            if (amount > cap) revert BidExceedsCap();
            bidDiscount[msg.sender] = amount;
        }

        // CEI
        revealed[msg.sender] = true;
        revealCount++;

        emit Revealed(msg.sender, currentRound, mode == Mode.AUCTION ? amount : 0);

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

        // FSM fix: if slashing removed the last non-revealer, advance to DRAW.
        // slash() marks the defaulter as joined=false before this call, so
        // _checkAllRevealed() sees the reduced active set and fires if everyone
        // remaining has revealed.
        if (state == State.REVEAL) _checkAllRevealed();
    }

    // ─── claim ─────────────────────────────────────────────────────────────────
    /// @notice Pull-payment: withdraw accumulated claimable balance. CEI + nonReentrant.
    function claim() external nonReentrant {
        uint256 amount = memberInfo[msg.sender].claimable;
        if (amount == 0) revert NothingToClaim();

        // CEI: zero before transfer
        memberInfo[msg.sender].claimable = 0;

        IERC20(stable).safeTransfer(msg.sender, amount);
        emit Claimed(msg.sender, amount);
    }

    // ─── requestDraw ───────────────────────────────────────────────────────────
    /// @notice Permissionless: signal that a VRF draw is needed for the current
    ///         round. Records the timestamp so reclaimOnStall can fire if VRF
    ///         goes silent.
    ///         The circle SPONSORS the Entropy fee out of its own MON balance,
    ///         so the (permissionless) caller never pays for randomness.
    function requestDraw() external {
        if (state != State.DRAW) revert NotDrawPhase();
        if (drawRequestedAt != 0) revert DrawAlreadyRequested();
        drawRequestedAt = block.timestamp;

        // entropyContract == 0 → permissionless/test mode: no Pyth request is
        // made; the draw is delivered by a direct _entropyCallback (local tests
        // and demo scripts). Guards above still gate the phase.
        if (entropyContract != address(0)) {
            uint256 fee = IEntropyV2(entropyContract).getFeeV2();
            if (address(this).balance < fee) revert InsufficientVrfFunding();
            vrfSequenceNumber = IEntropyV2(entropyContract).requestV2{value: fee}();
        }

        emit DrawRequested(currentRound, drawRequestedAt);
    }

    /// @notice Accept MON to sponsor Entropy fees. Anyone may top a circle up.
    receive() external payable {
        emit VrfFunded(msg.sender, msg.value);
    }

    /// @notice Quote the current Entropy fee for one draw (0 in test mode).
    function vrfFeeEstimate() external view returns (uint256) {
        if (entropyContract == address(0)) return 0;
        return IEntropyV2(entropyContract).getFeeV2();
    }

    /// @inheritdoc IEntropyConsumer
    function getEntropy() internal view override returns (address) {
        return entropyContract;
    }

    // ─── entropyCallback (Pyth Entropy callback) ───────────────────────────────
    /// @notice Invoked via IEntropyConsumer._entropyCallback, which has already
    ///         enforced msg.sender == getEntropy(). Picks a winner from eligible
    ///         (joined && !hasWon) members, credits the pot, and advances state.
    ///
    ///         MUST NEVER REVERT: per Pyth's docs a reverting callback cannot be
    ///         re-delivered by the keeper, which would strand the draw forever
    ///         (the fee is already spent and the sequence number is consumed).
    ///         Every precondition below is therefore a silent `return`, not a
    ///         revert. If it no-ops, reclaimOnStall() is still the safety valve.
    ///         nonReentrant is deliberately NOT applied here — see report.
    function entropyCallback(uint64 sequenceNumber, address /*provider*/, bytes32 randomNumber)
        internal
        override
    {
        if (state != State.DRAW) return;
        if (drawRequestedAt == 0) return;
        if (sequenceNumber != vrfSequenceNumber) return;

        uint256 randomness = uint256(randomNumber);

        // Build eligible list: joined && !hasWon
        uint256 n = members.length;
        address[] memory eligible = new address[](n);
        uint256 eligibleCount = 0;
        for (uint256 i = 0; i < n; i++) {
            address m = members[i];
            if (memberInfo[m].joined && !hasWon[m]) {
                eligible[eligibleCount++] = m;
            }
        }

        // Guard: if all members were slashed before VRF fired, no one is eligible.
        // Transition to STALLED so members can recover via reclaimOnStall().
        // TODO(security-audit): when eligibleCount == 0, the roundPool accumulated this round
        // is NOT redistributed here — it remains in roundPool. Members must call reclaimOnStall()
        // to recover it. This is a known edge case flagged for the M6 security-auditor gate.
        if (eligibleCount == 0) {
            state = State.STALLED;
            _refundVrf();
            emit Stalled(currentRound);
            return;
        }

        // CEI: update state before transfers
        address winner;
        uint256 discount;

        if (mode == Mode.LUCKY_DRAW) {
            uint256 winnerIdx = randomness % eligibleCount;
            winner = eligible[winnerIdx];
            discount = 0;
        } else {
            // AUCTION: recompute the highest bid and the set of eligible
            // members tied at that bid directly from bidDiscount[], scanning
            // only `eligible` (already joined && !hasWon). Single source of
            // truth for "who's winning" — no running "highest so far" tracker.
            uint256 topBid = 0;
            uint256 tiedCount = 0;
            for (uint256 i = 0; i < eligibleCount; i++) {
                uint256 b = bidDiscount[eligible[i]];
                if (b > topBid) {
                    topBid = b;
                    tiedCount = 1;
                } else if (b == topBid) {
                    tiedCount++;
                }
            }

            if (topBid > 0 && tiedCount == 1) {
                for (uint256 i = 0; i < eligibleCount; i++) {
                    if (bidDiscount[eligible[i]] == topBid) {
                        winner = eligible[i];
                        break;
                    }
                }
                discount = topBid;
            } else if (topBid > 0) {
                // Genuine tie at a positive top bid: lottery held ONLY among
                // the tied top bidders, not the whole eligible set.
                address[] memory tied = new address[](tiedCount);
                uint256 tiedIdx = 0;
                for (uint256 i = 0; i < eligibleCount; i++) {
                    if (bidDiscount[eligible[i]] == topBid) {
                        tied[tiedIdx++] = eligible[i];
                    }
                }
                winner = tied[randomness % tiedCount];
                discount = topBid;
            } else {
                // topBid == 0: nobody bid above zero (or sole remaining
                // member's own bid is zero). Fall back to VRF over the FULL
                // eligible set at zero discount.
                uint256 winnerIdx = randomness % eligibleCount;
                winner = eligible[winnerIdx];
                discount = 0;
            }
        }

        hasWon[winner] = true;

        uint256 pot = roundPool;
        roundPool = 0;

        if (discount > 0) {
            // Distribute the discount as a dividend to ALL joined members,
            // including the winner — matching the real-world chit-fund rule
            // that the discount is split equally among all subscribers.
            //
            // DELIBERATE DIVERGENCE: real chit funds deduct a foreman/organizer
            // commission (5%, capped at 7% since the Chit Funds Amendment Act
            // 2019) from `discount` here before splitting, and the foreman
            // keeps it. Bhishi takes NO commission — the full discount goes
            // back to subscribers. This is the fee-free product design, not an
            // omission; the winner gets `pot - discount` (line below) plus
            // their own per-member share, so the whole discount is conserved
            // among members with no rake.
            uint256 joinedForDividend = _activeCount();
            uint256 sharePerMember = discount / joinedForDividend;
            uint256 dividendDust = discount - sharePerMember * joinedForDividend;
            for (uint256 i = 0; i < n; i++) {
                address m = members[i];
                if (memberInfo[m].joined) {
                    memberInfo[m].claimable += sharePerMember;
                }
            }
            dustAccrued += dividendDust;
            memberInfo[winner].claimable += (pot - discount);
        } else {
            memberInfo[winner].claimable += pot;
        }

        emit WinnerDrawn(currentRound, winner, randomness);

        // Determine if this was the last round.
        // Fast-path: round index matches seat count (assumes no slashing removed members).
        // Fallback: remainingEligible==0 catches the case where slashed members reduced
        // the active set such that everyone who can win has already won.
        bool lastRound = (currentRound + 1 == seats);
        if (!lastRound) {
            // Check if all remaining joined members have now won
            uint256 remainingEligible = 0;
            for (uint256 i = 0; i < n; i++) {
                if (memberInfo[members[i]].joined && !hasWon[members[i]]) {
                    remainingEligible++;
                }
            }
            if (remainingEligible == 0) lastRound = true;
        }

        if (lastRound) {
            // Return bonds to all members via claimable; attest reputation
            // Release dust to first joined member so it is always claimable (LEAK 3 conservation)
            uint256 dust = dustAccrued;
            dustAccrued = 0;
            bool dustAssigned = false;
            for (uint256 i = 0; i < n; i++) {
                address m = members[i];
                if (memberInfo[m].joined) {
                    if (memberInfo[m].stakedBond > 0) {
                        memberInfo[m].claimable += memberInfo[m].stakedBond;
                        memberInfo[m].stakedBond = 0;
                    }
                    if (!dustAssigned && dust > 0) {
                        memberInfo[m].claimable += dust;
                        dustAssigned = true;
                    }
                }
            }
            // If no joined member exists to absorb dust, re-park it (edge case)
            if (!dustAssigned) dustAccrued = dust;

            drawRequestedAt = 0;
            state = State.COMPLETED;

            // Circle is over — return unspent VRF sponsorship to the creator.
            _refundVrf();

            // M6: attest all joined members in the reputation registry
            if (reputation != address(0)) {
                for (uint256 i = 0; i < n; i++) {
                    address m = members[i];
                    if (memberInfo[m].joined) {
                        IReputationRegistry(reputation).attest(m, currentRound + 1);
                    }
                }
            }
        } else {
            // Advance to next round: reset per-round state
            currentRound++;
            drawRequestedAt = 0;
            revealCount = 0;
            // Reset EVERY member for the new round — past winners included.
            // They must actively commit (pay) again; the auto-reveal for winners
            // now happens in commit(), only after they've paid this round.
            for (uint256 i = 0; i < n; i++) {
                address m = members[i];
                committed[m]   = false;
                revealed[m]    = false;
                bidDiscount[m] = 0;
            }
            roundStart = block.timestamp;
            state = State.COMMIT;
            emit RoundStarted(currentRound, roundStart);
        }
    }

    // ─── reclaimOnStall (LEAK 1, money shot 4) ─────────────────────────────────
    /// @notice Permissionless safety valve: if VRF has been silent for
    ///         VRF_TIMEOUT since requestDraw(), anyone can stall the circle and
    ///         let members reclaim their funds via claim().
    function reclaimOnStall() external nonReentrant {
        if (state != State.DRAW) revert NotDrawPhase();
        if (drawRequestedAt == 0) revert DrawNotRequested();
        if (block.timestamp < drawRequestedAt + VRF_TIMEOUT) revert VrfTimeoutNotElapsed();

        // CEI: set terminal state first
        state = State.STALLED;

        // Count joined members
        uint256 n = members.length;
        uint256 joinedCount = 0;
        for (uint256 i = 0; i < n; i++) {
            if (memberInfo[members[i]].joined) joinedCount++;
        }

        // Merge stranded dustAccrued from prior slashings into the pool so it
        // is recoverable by members (not permanently stuck in the contract).
        uint256 pool = roundPool + dustAccrued;
        roundPool   = 0;
        dustAccrued = 0;
        uint256 sharePerMember = joinedCount > 0 ? pool / joinedCount : 0;
        uint256 dust = pool - sharePerMember * joinedCount;

        // Assign remainder dust to first joined member so nothing is stranded.
        bool dustAssigned = false;
        for (uint256 i = 0; i < n; i++) {
            address m = members[i];
            if (memberInfo[m].joined) {
                // Bond + claimable already theirs; add pro-rata pool share
                memberInfo[m].claimable += memberInfo[m].stakedBond + sharePerMember;
                memberInfo[m].stakedBond = 0;
                if (!dustAssigned && dust > 0) {
                    memberInfo[m].claimable += dust;
                    dustAssigned = true;
                }
            }
        }
        // If no joined member (degenerate), re-park dust
        if (!dustAssigned) dustAccrued = dust;

        _refundVrf();

        emit Stalled(currentRound);
    }

    // ─── internal helpers ──────────────────────────────────────────────────────

    /// @notice Return any leftover VRF sponsorship MON to the creator.
    /// @dev    A failed refund (creator is a contract that rejects MON, or is
    ///         unset) must NEVER trap the ROSCA: the send result is recorded in
    ///         the event but never reverts the terminal transition. The stable
    ///         (ERC20) money path is entirely independent of this native balance.
    function _refundVrf() internal {
        uint256 amount = address(this).balance;
        if (amount == 0 || creator == address(0)) return;
        (bool ok, ) = creator.call{value: amount}("");
        emit VrfRefunded(creator, amount, ok);
    }

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
