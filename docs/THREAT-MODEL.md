# Bhishi — Threat Model

> This document exists so a reviewer never has to *ask* whether we thought about an attack —
> the question and our on-chain answer are already written down. Each threat below has a
> corresponding test file that proves the mitigation, not just claims it.

The unifying invariant everything defends:

> **No state, and no external-system failure, may ever trap a member's funds behind a
> permissioned action. Every wei is either paid out by contract-computed rule, or reclaimable
> permissionlessly. The organizer has no discretionary power — and neither does the oracle.**

---

## Trust boundaries

| Component | We trust it for | We do NOT trust it for | Bound on the trust |
|---|---|---|---|
| Organizer | Nothing beyond parameter setup + inviting | Custody, winner choice, advancing the draw | Zero — no privileged fund path exists |
| Gelato VRF | Delivering unbiased randomness *eventually* | Custody, fairness manipulation | **Liveness only, for ≤ `VRF_TIMEOUT`** — then `reclaimOnStall()` |
| MockStable ERC-20 | Exact-amount transfers | Fee-on-transfer / rebasing behavior | Documented assumption; real-token variant is roadmap |
| CircleFactory | Being the sole minter of legit circles | — | It holds no funds; only gates `isCircle()` |

---

## Threats & mitigations (each maps to a test)

### T1 — Organizer drains the pool
**Attack:** organizer calls any function to move escrowed funds to itself.
**Mitigation:** no such code path exists. Only four outbound transfer kinds, all contract-computed
(payout / slash-redistribute / bond-return / reclaim). **Proof:** `Custody.t.sol` — every plausible
organizer withdraw attempt `expectRevert`.

### T2 — Organizer rigs who wins, or when
**Attack:** organizer sets the winner or front-runs the draw to favor a crony.
**Mitigation:** `hasWon` is set **only** inside `fulfillRandomness`, callable **only** by the VRF operator;
winner index derives from Drand-backed randomness. No organizer input reaches selection. **Proof:**
`Fairness.t.sol` — asserts no organizer path mutates winner state; selection excludes prior winners.

### T3 — VRF stalls and freezes everyone's money (the sleeper)
**Attack / failure:** Gelato never calls back (outage, censorship, testnet flakiness). Round can't advance;
funds sit escrowed forever. A "non-custodial" contract with a frozen exit is just a different custodian.
**Mitigation:** after `drawRequestedAt + VRF_TIMEOUT`, circle enters `STALLED`; **any member** calls
`reclaimOnStall()` and recovers current-round contribution + remaining bond, exactly, permissionlessly.
**Proof:** `ReclaimOnStall.t.sol` — simulate no fulfilment, assert every member fully recovers, sum conserved.

### T4 — Win early, then default (the real economic exploit)
**Attack:** member wins round 1 (interest-free loan), then stops contributing the remaining `(N−1)` rounds,
walking with `pool − bond`.
**Mitigation:** `required_bond ≥ (seats − 1) × contribution`, **enforced at `createCircle` (reverts otherwise)**.
Bond always ≥ maximum remaining obligation → default forfeits at least what's owed → strictly irrational.
**Proof:** `CollateralSizing.t.sol` (under-sized circle won't deploy) + `WinnerDefault.t.sol`
(fuzz: no default strategy is profitable).

### T5 — Redistribution dust becomes trapped value
**Attack / bug:** integer-division remainder in pro-rata slashing accretes in the contract with no claim path;
silent value leak across circles.
**Mitigation:** remainder assigned to a deterministic `dustAccrued` bucket, released at `COMPLETED`.
**Proof:** `ConservationInv.t.sol` — at **every** state transition,
`balanceOf(circle) == Σ claimable + dustAccrued + undrawn pools`. Fuzzed. Zero trapped wei.

### T6 — Fake circle mints reputation
**Attack:** deploy a sham contract mimicking `Circle`, call `ReputationRegistry.attest` in a loop, fabricate
completion history → poisons the positive-reputation signal.
**Mitigation:** `attest` requires `factory.isCircle(msg.sender)` — only factory-deployed clones can write.
**Proof:** `FakeCircleAttest.t.sol` — sham circle's `attest` call `expectRevert`.

### T7 — Unfilled circle strands the early joiners' bonds
**Attack / failure:** members stake bonds, remaining seats never fill; funds stuck in `FILLING`.
**Mitigation:** after `FILLING_TIMEOUT`, `refundFilling()` is permissionless; every staker recovers their bond.
**Proof:** `FillingTimeout.t.sol`.

### T8 — Reentrancy on payout / slash / reclaim
**Attack:** malicious token or callback re-enters during an outbound transfer to double-withdraw.
**Mitigation:** Checks-Effects-Interactions ordering + `nonReentrant` on all fund-moving functions; state
updated before transfer. **Proof:** reentrancy attacker harness in `Slashing.t.sol` / `ReclaimOnStall.t.sol`.

### T9 — Win twice
**Mitigation:** `hasWon[member]` checked before eligibility; the selection array is rebuilt from not-yet-won
members each draw. **Proof:** covered in `Fairness.t.sol`.

### T10 — VRF request replay / cross-round confusion
**Mitigation:** `vrfRequestId` is bound to the specific round; a fulfilled request cannot be re-consumed, and
a fulfilment for a stale round is rejected. **Proof:** negative cases in `Fairness.t.sol`.

### T11 — Bid sniping (auction mode)
**Mitigation:** sealed-bid commit-reveal; bids hidden until reveal. **Proof:** `AuctionMode.t.sol`.

### T12 — Gas griefing via per-circle deploy cost
**Not an attack, a scale concern:** full-bytecode deploy per circle is expensive and doesn't scale.
**Mitigation:** EIP-1167 minimal-proxy clones of one audited implementation; ~constant, tiny deploy cost;
storage isolation preserved. **Proof:** factory clone test asserts independent storage/balances per clone.

---

## Explicitly out of scope (stated, not hidden)

- Off-chain cash / fiat-ramp fraud — outside the contract's trust boundary.
- Fee-on-transfer / rebasing stablecoins — escrow assumes exact-amount ERC-20.
- Stablecoin depeg — external market risk.
- FHE-grade amount privacy — commitment scheme hides declared metadata only; roadmap for ERC-7984.
- Person-level Sybil resistance — address-keyed reputation only; personhood binding is roadmap.
- Full recovery against a determined absconder beyond their staked bond — bond makes default irrational and
  the circle unwinds cleanly, but we do not claim to conjure a quitter's unpaid future contributions.

---

## How to verify every claim here

```
cd packages/contracts
forge test            # all mitigations above, including fuzz invariants
pnpm demo             # four money shots live on Monad testnet
```

If a claim in this document is not backed by a passing test, that is a bug in the document.
