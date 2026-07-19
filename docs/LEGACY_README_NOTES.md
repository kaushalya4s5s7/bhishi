# Legacy README Notes

The README was rewritten on 2026-07-20 after the **Design A** fix (see
[DESIGN_A_PLAN.md](../DESIGN_A_PLAN.md)) shipped and a new contract stack was
deployed. This file preserves what the old README said, why it's now wrong or
superseded, and where its content moved — so nobody re-derives this history
from git blame.

## What changed and why the old README is stale

### 1. The old README's "walkthrough" numbers were produced by a BUGGY contract

The auction-mode and lucky-draw-mode walkthroughs in the pre-2026-07-20
README (`0x509b1505…` auction circle, `0x1747d6be…` lucky-draw circle) were
run against a `Circle.sol` with the **shrinking-pot bug**: a past winner was
auto-marked `committed=true`/`revealed=true` at round start *without paying*,
so `roundPool` only ever collected `contribution × (seats − winners so far)`
instead of the full `contribution × seats`. This meant:

- The 40%-of-pot AUCTION bid cap shrank every round a winner existed.
- A real production circle (`0x3e1A…9a8F`, 3×10 mUSDC) hit `BidExceedsCap`
  reverting a legitimate `reveal(10 mUSDC)` in round 2, because the real cap
  had shrunk to 8 mUSDC while the UI still showed 12 (computed against the
  full pool).
- Each round's winner got a fraction of what the first winner got — breaking
  ROSCA fairness (the whole point of the product).

The three-round walkthroughs in the old README are still *internally
consistent* (the bug didn't corrupt conservation — `balance == claimable +
dust + undrawn + bonds` still held every round, it just meant the pot itself
was smaller than intended). But they are NOT representative of correct
contract behavior, and must not be used as a reference for expected pot
sizes or cap values in future circles.

### 2. Design A fix: what changed in `Circle.sol`

- `Revealed` event now carries the bid (`event Revealed(member, round, bid)`)
  — enables the persistent bid-history table in the web UI.
- Past winners now PAY `contribution` every round via `commit()` (same as
  everyone else) — they just can't bid or win again. They're auto-marked
  `revealed=true` with a forced `bidDiscount=0` immediately after their
  `commit()` succeeds (not at round-advance, and only in AUCTION mode — see
  note 4 below).
- Round-advance (`entropyCallback`) resets EVERY member's `committed`/
  `revealed`/`bidDiscount` uniformly — no more special-casing past winners.
- Net effect: `roundPool` is always `contribution × seats`, every round, for
  the life of the circle. The 40% cap is stable and matches what the UI shows.

Full spec: [DESIGN_A_PLAN.md](../DESIGN_A_PLAN.md).

### 3. New contract deployment (2026-07-19/20)

The old README's "Deployed Contracts" table pointed at:

| Contract | Old address |
|----------|-------------|
| CircleFactory | `0x384597AE10181bC7215f4a57aF6caAe1a6eE26dc` |
| Circle (impl) | `0x0785C9d98130791f0f0644a65b39f0a20b2DdA0d` |
| ReputationRegistry | `0x9d1bA8144DF7cE5A60f3378adBE87A3a97Aa4F02` |

These addresses run the OLD (buggy) `Circle.sol` and are **not upgraded in
place** — circles already created there keep running on the old logic until
they complete or stall (see `packages/contracts/script/DeployDesignA.s.sol`
for why: `ReputationRegistry.factory` is immutable, so deploying a new
factory required a new registry too). `MockStable` (mUSDC) was **reused**
across the redeploy — it holds real user balances and has no bug to fix.

The new README documents the **current** deployment. See the top-level
`README.md` "Deployed Contracts" table for current addresses.

**The stuck circle** `0x3e1A…9a8F` mentioned above is permanently on the old
contract and cannot be migrated — its round-2 bid is hash-locked and
un-revealable under the old logic. It resolves via stall/slash, not a fix.

### 4. A subtlety worth keeping in mind: LUCKY_DRAW vs AUCTION past-winner behavior

Design A's "past winners pay but skip reveal" auto-behavior is **AUCTION-only**.
The guard in `commit()` is `if (mode == Mode.AUCTION && hasWon[msg.sender])`.

In LUCKY_DRAW mode there is no bidding to exclude a past winner from, so past
winners behave exactly like every other member every round: they commit,
they manually reveal (their revealed `amount` must equal `contribution` —
enforced in `reveal()`), and they're excluded only from being **drawn**
again (`eligible = joined && !hasWon` in the winner-selection). This was not
obvious from the plan's prose alone (which frames the fix mostly in AUCTION
terms) and cost a live-testnet debugging round when the first LUCKY_DRAW
lifecycle test assumed the AUCTION skip-reveal rule applied everywhere — see
`scripts/lifecycle-run.ts` for the corrected logic (`isAuction &&
(await hasWon(...))`, not just `hasWon(...)`).

### 5. Where old README content moved

- The four money-shot proofs (CUSTODY, FAIRNESS, DEFAULT, LIVENESS) — concept
  unchanged, still true of the current contract. Kept in the new README.
- The "verifiable randomness — proven on-chain" Pyth Entropy explanation —
  concept unchanged. New README re-verifies it against the new deployment's
  own real Pyth keeper transactions (see `scripts/lifecycle-run.ts` output).
- The two full walkthrough tables (auction `0x509b1505…`, lucky-draw
  `0x1747d6be…`) — superseded by new walkthroughs run on the new deployment
  via `scripts/lifecycle-run.ts` (see `scripts/out/lifecycle-*.json` for the
  full machine-readable logs of every transaction). The OLD circles are still
  on-chain and still show `state = COMPLETED` if anyone wants to inspect the
  pre-fix behavior for historical/audit purposes — just don't use their pot
  sizes as a reference.
- Architecture diagram, Quick Start, Deploy, Invariants Proven, Tech Stack —
  carried forward with address/contract-name updates only.

## Old README, for reference

The full pre-2026-07-20 text is preserved in git history
(`git show e033336:README.md` — the last commit that touched `README.md`
before this rewrite) rather than duplicated here — it's long, and git
already stores it losslessly.
