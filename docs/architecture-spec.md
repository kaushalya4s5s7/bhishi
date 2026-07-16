# Bhishi — Production Architecture Specification (v2, hardened)

> A non-custodial savings circle (ROSCA / chit fund) on Monad where **no organizer can hold the pool,
> no organizer can rig the payout order, and no external failure can trap a member's funds.**
> Built for the Monad "Spark" hackathon.

---

## 0. One-line thesis

Every savings circle in the world runs on one dangerous sentence: *"trust the person holding the money."*
That person has two discretionary powers — **holding the pool** and **choosing who gets paid when**.
Bhishi removes **both**, on-chain, verifiably. And it removes a third danger nobody designs for:
the possibility that the machinery itself (the oracle, an unfilled circle) **strands your money**.

**The sharpened invariant (supersedes "non-custodial"):**

> **No state, and no external-system failure, may ever trap a member's funds behind a permissioned action.**
> Every wei is either paid out by contract-computed rule, or reclaimable **permissionlessly**.
> The organizer has no discretionary power — **and neither does the oracle.**

Non-custodial escrow kills the first power. Verifiable randomness kills the second. **Permissionless reclaim
paths** kill the third. That third one is what separates this from every dead onchain-ROSCA that came before.

---

## 1. Scope & honesty boundaries (read first)

**What Bhishi IS:** a non-custodial, verifiably-fair, **liveness-safe** savings circle for participants who
already hold a stablecoin. The contract holds funds; the organizer cannot withdraw; payout order is set by
Gelato VRF, not by any human; and if the VRF or the group stalls, **any member** can unwind the circle and
recover exactly what they are owed, with no one's permission.

**What Bhishi is NOT (stated openly — roadmap / out of scope):**
- Not a fix for off-chain cash fraud. The fiat↔stablecoin ramp is off-chain, outside the contract's trust
  boundary. Origin-story community ≠ day-1 user.
- Not FHE-private. Amounts are hidden via a **commitment scheme** (publicly hidden), not computed-on-ciphertext.
  Full FHE / ERC-7984 = roadmap.
- Not Sybil-proof at the person level. Reputation is a per-circle **positive-only** attestation keyed to an
  address; proof-of-personhood binding is roadmap.
- Not a guarantee against loss when a member **outright abandons** the circle mid-way. Collateral is sized so
  that default is **economically irrational** (§8), and if it happens anyway the circle unwinds cleanly — but
  we do not claim magic recovery of a determined absconder's owed contributions beyond their staked bond.

**Verified platform facts (do not re-research):**
- Monad testnet = EVM-compatible at bytecode level; plain Solidity + standard tooling works.
- Gelato VRF = live on Monad testnet, Drand-backed. Use for winner selection. **Never** `block.timestamp`/`blockhash`.
- Inco/Zama FHE (ERC-7984) = live on Base, **not** on Monad → commitment scheme instead.
- Human Passport / World ID = not confirmed on Monad testnet → own attestation now, personhood roadmap.

---

## 2. Actors & roles

| Actor | Powers | Explicitly CANNOT |
|---|---|---|
| **Organizer (Coordinator)** | Create circle, set params, invite members | Withdraw funds; pick the winner; alter contributions; change params after start; advance the draw |
| **Member** | Join (stake bond), commit + reveal each round, receive payout when drawn, **trigger permissionless reclaim on stall** | Withdraw others' funds; win twice; skip a round without slashing |
| **Contract** | Custody the pool, verify contributions, request VRF, transfer payout, slash defaulters, compute reclaim | Hold value that is not attributable to a member's claim |
| **Gelato VRF** | Deliver verifiable randomness on request | Influence which member is eligible; **freeze funds** (bounded by reclaim timeout) |

**Non-custodial invariant (enforced in code):** there exists **no code path** by which the organizer transfers
pool funds to itself or an arbitrary address. Every outbound transfer is one of exactly four contract-computed
kinds: (a) payout → VRF-selected winner, (b) slash redistribution → compliant members, (c) collateral/bond
return → a member who completed the circle, (d) **reclaim → a member unwinding a stalled circle.** None are
organizer-directed.

---

## 3. Layered architecture

```
┌─ EXPERIENCE      Landing page (waitlist + try-it) → Privy embedded wallet (email/social, no seed
│                  phrase) → gas-sponsored txs (paymaster). User never sees crypto. Mobile-first.
│                  Surfaces invariants, not just forms. (Full detail in §11.5.)
├─ IDENTITY        Own EAS-style per-circle completion attestation (positive-only), factory-gated.
│                  Roadmap: World ID / Human Passport personhood nullifier.
├─ PRIVACY         Commitment scheme: hash(amount, salt, member) commit → reveal. Amounts hidden on explorer.
│                  Roadmap: FHE / ERC-7984 confidential stablecoin.
├─ BHISHI CORE     Non-custodial escrow + round FSM + Gelato VRF + full-bond collateral + slashing
│                  + PERMISSIONLESS RECLAIM (VRF stall, filling stall).
├─ SETTLEMENT      Monad testnet + mock stablecoin ERC-20 + Gelato VRF (Drand).
```

---

## 4. Contract topology

- **`CircleFactory`** — deploys `Circle` instances as **EIP-1167 minimal-proxy clones** of one audited
  implementation (cheap deploys, storage isolation preserved). Maintains an `isCircle(address)` registry.
  Enforces the **collateral-sizing invariant** at creation (§8): reverts if `bond < (seats − 1) × contribution`.
  Emits `CircleCreated`. No custody.
- **`Circle`** (implementation + clones) — the escrow + state machine for one savings group. Holds all funds.
  Core of the system. Clone-safe: no constructor state; initialized via `initialize(...)` once.
- **`ReputationRegistry`** — append-only, positive-only attestations. `attest(member, circleId)` callable
  **only** when `CircleFactory.isCircle(msg.sender) == true` **and** the caller reached `COMPLETED`. Gating
  the write path to factory-registered circles is load-bearing: without it, a sham `Circle` mints fake
  reputation. No negative/blacklist entries.
- **`MockStable`** — testnet ERC-20 stablecoin (6 decimals), faucet-mintable. Assumed exact-amount transfer
  (no fee-on-transfer / rebasing); documented assumption.
- **VRF consumer** — `Circle` implements the Gelato VRF consumer interface (`fulfillRandomness`).

**Isolation by deployment:** each circle is its own clone with its own storage and balance. One circle's funds
can never touch another's. The factory holds nothing.

---

## 5. `Circle` state machine

```
CREATED ─join(bond+r0)─> FILLING ─(all seats + bonds staked)─> ACTIVE
   │                          │
   │                          └─(FILLING_TIMEOUT elapsed, not full)─> ABORTED_FILLING
   │                                                                        │
   ▼                                                          permissionless refundFilling()
 round loop:  COMMIT ─> REVEAL ─> DRAW(VRF req) ─> PAYOUT ─> next round
                 │         │           │
                 │         │           └─(VRF_TIMEOUT after request, no fulfil)─> STALLED
                 │         │                                                          │
                 │      missed/invalid reveal ─> SLASH ─> continue                    │
                 │                                                    permissionless reclaimOnStall()
                 └─(all members hasWon) ─────────────────────────> COMPLETED
```

**Per-round phases (each time-boxed by block-timestamp deadline, not organizer whim):**
1. **COMMIT** — every member submits `commitment = keccak256(abi.encode(amount, salt, msg.sender))` and
   transfers the fixed contribution into escrow. (See §7 for honest privacy scope.)
2. **REVEAL** — members reveal `(amount, salt)`. Contract checks the hash and that escrowed amount matches.
   Missing/invalid reveal ⇒ eligible for slash.
3. **DRAW** — contract requests Gelato VRF. Records `drawRequestedAt`. **No human can advance this.**
4. **PAYOUT** — on `fulfillRandomness`, contract selects a not-yet-won member and transfers the round pool.
5. Repeat until all `hasWon`; then **COMPLETED** → bonds returned, dust released, attestations written.

**Terminal-safety states (the hardening):** `ABORTED_FILLING` and `STALLED` are not error states — they are
first-class exits with **permissionless** withdrawal, ensuring no path traps funds.

---

## 6. Winner selection (Gelato VRF) + liveness fallback

- On DRAW, `Circle` requests randomness; stores `drawRequestedAt`, `vrfRequestId`.
- `fulfillRandomness(requestId, randomness)` (callable **only** by the VRF operator):
  - Build the array of not-yet-won members.
  - `winnerIdx = randomness % remaining.length` — modulo bias is negligible at 256-bit randomness / small N;
    documented, not hidden.
  - Set `hasWon[winner] = true`, transition to PAYOUT, transfer pool.
- **Invariant:** the organizer has no function that sets or influences the winner. Only path is inside
  `fulfillRandomness`.
- **Liveness fallback — `reclaimOnStall()` (LEAK-1 close):** if `block.timestamp > drawRequestedAt +
  VRF_TIMEOUT` and no fulfilment arrived, the circle enters `STALLED`. **Any member** may then withdraw their
  own share: current-round contribution (not yet paid out) **+ remaining bond**, computed exactly. No
  organizer, no oracle, no admin. This bounds the trust placed in Gelato to *liveness only, for at most
  VRF_TIMEOUT* — never fairness, never custody.
- **Auction mode (`mode == AUCTION`, implemented):** each round, non-winning members submit sealed
  bids via the same commit-reveal machinery (bid = discount they'll accept off the round pot,
  capped at 40% of the pot — standard chit-fund convention). Highest revealed bid wins the
  discounted pot; ties (or an all-zero/no-bid round) fall back to Gelato VRF among the tied/eligible
  set, exactly mirroring the real-world "lottery when nobody bids" (and "lottery among tied top
  bidders") rules under the Chit Funds Act, 1982. The discount is distributed as a pro-rata dividend
  to **every** joined member, including that round's winner and past winners — matching the authentic
  chit-fund rule that the discount is "distributed equally amongst all subscribers." Once a member
  wins, they are permanently excluded from future bidding ("prized subscriber" rule), continuing to
  pay contributions and receive dividends until the circle completes. Winners still pay their full
  round contribution regardless of their bid — unchanged from LUCKY_DRAW.

  **One deliberate divergence from real-world chit funds:** authentic funds deduct a *foreman
  (organizer) commission* — 5% of the chit value, capped at 7% since the Chit Funds (Amendment) Act,
  2019 — from the discount *before* the dividend split, and the foreman keeps it. Bhishi charges **no
  such commission**: the entire discount flows back to subscribers as dividend. This is the core
  product differentiator (a trustless, fee-free ROSCA with no middleman rake), not an oversight — it
  is the one place Bhishi intentionally improves on the traditional model rather than replicating it.
  Every other mechanic (highest-discount-wins, 40% cap, all-member dividend, prized-subscriber
  exclusion, lot-based tie/no-bid fallback, fixed full monthly contribution) faithfully matches the
  real-world flow. DRAW remains the polished demo path; AUCTION ships with unit tests
  (`Auction.t.sol`) plus a conservation-invariant fuzzer.

---

## 7. Privacy — commitment scheme (honest scope)

- **Hides:** each member's declared contribution metadata, committed as `keccak256(amount, salt, member)` in
  COMMIT, opened only in REVEAL. Nothing leaks on-explorer until reveal.
- **Does NOT hide:** raw ERC-20 `transfer` amounts into escrow (visible at token level). For a
  fixed-contribution circle (everyone pays known X) this is acceptable. We do **not** claim FHE-grade privacy.
- **Load-bearing, not decorative:** the commit-reveal mismatch is itself the slashable default signal
  (committed to pay, failed to reveal/fund) — the scheme drives default detection.
- **Roadmap:** FHE / ERC-7984 confidential stablecoin.

---

## 8. Collateral as a post-win liability bond (the economic core)

**The real default vector is the winner, not the laggard.** A member who wins round 1 has received an
interest-free loan and **still owes `(N − 1)` future contributions**. Their rational move is to default
*after* winning. A flat "deposit" does not deter this. Therefore collateral is sized as a **liability bond**:

```
required_bond ≥ (seats − 1) × contribution
```

- **Enforced at creation:** `CircleFactory.createCircle` **reverts** if `bond < (seats − 1) × contribution`.
  A circle that could be profitably defaulted on *cannot be deployed*. (LEAK-2 close.)
- **Effect:** for any member, at any point, `bond ≥ their maximum remaining obligation` → defaulting forfeits
  a bond worth at least what they still owe. Post-win default becomes strictly irrational. Proven by
  `WinnerDefault.t.sol` (fuzz: no strategy makes default profitable).
- **Demo sizing:** N = 4–5, contribution = 100 → bond = 300–400 units. Capital-heavy but **honest and
  correct** — we chose the simpler, provably-safe contract over a payout-streaming scheme (roadmap).
- **Slashing on default:** defaulter's bond tops up the shorted round (winner made whole first), remainder
  redistributed pro-rata to compliant members; defaulter marked `removed`, forfeits future bond and any
  attestation.

**Dust / conservation (LEAK-3 close):** pro-rata redistribution uses integer division → remainder. Remainder
is assigned **deterministically** (to a `dustAccrued` bucket released at `COMPLETED`), never trapped.
Invariant `ConservationInv.t.sol` asserts at **every** state transition:

```
token.balanceOf(circle) == Σ (each member's claimable balance) + dustAccrued + undrawn round pools
```

Zero trapped wei, fuzz-proven. *This is the "we care about every small loss" guarantee, made mechanical.*

---

## 9. Reputation (positive-only, factory-gated)

- `ReputationRegistry.attest(member, circleId)` — callable **only** when `factory.isCircle(msg.sender)` and the
  circle reached `COMPLETED`, once per member. Emits `CircleCompleted(member, circleId)`. (LEAK-4 close.)
- Query: "how many circles has this address completed?" → sortable, permissionless, no central admin.
- **No blacklist.** Negative reputation is Sybil-bypassable (new wallet = clean slate) and a defamation
  liability. Positive-only + (roadmap) personhood binding is the correct model.

---

## 10. Security model

| Vector | Mitigation |
|---|---|
| Organizer theft | No withdraw path to organizer; enforced by absence + `Custody.t.sol` asserting revert |
| Rigged payout order | Winner set only in `fulfillRandomness`; VRF Drand-backed, unriggable |
| **VRF stall / oracle freeze** | **`reclaimOnStall()` permissionless after `VRF_TIMEOUT`** — funds never trapped (LEAK 1) |
| **Winner default after payout** | **Bond ≥ (N−1)×contribution**, enforced at creation; default forfeits ≥ owed (LEAK 2) |
| **Redistribution dust / trapped value** | Deterministic dust bucket + conservation invariant, fuzz-proven (LEAK 3) |
| **Fake-circle reputation minting** | `attest` gated to `factory.isCircle(msg.sender)` (LEAK 4) |
| Per-circle deploy gas / scale | EIP-1167 clones of one audited implementation (LEAK 5) |
| **Stranded collateral on unfilled circle** | `FILLING_TIMEOUT` → permissionless `refundFilling()` (LEAK 6) |
| Reentrancy on payout/slash/reclaim | Checks-Effects-Interactions + `nonReentrant`; state before transfer |
| Winner-twice | `hasWon` checked; selection pool excludes winners |
| Bid sniping (auction) | Commit-reveal bids |
| Collateral griefing | Time-boxed phases by block-timestamp deadline; auto-slash, no organizer discretion |
| VRF request replay | `vrfRequestId` bound to round; fulfilled request cannot be re-consumed |
| Fee-on-transfer / rebasing token | Out of scope; escrow assumes exact-amount ERC-20; documented |
| Stablecoin depeg | Out of scope (external); documented risk |
| Randomness manipulation | Gelato VRF only; explicit ban on `block.*` randomness in review + lint |

---

## 11. Tech stack & monorepo

**Monorepo:** pnpm workspaces + Turborepo.

```
bhishi/
├─ apps/web/                      # Next.js 14, wagmi/viem, RainbowKit, mobile-first
├─ packages/
│  ├─ contracts/                  # Foundry — the moat
│  ├─ shared/                     # forge build → ABIs + typed viem + addresses.ts (single source)
│  └─ events/                     # RPC event reader (audit trail; indexer folded in for the sprint)
├─ scripts/demo.ts                # four money shots, live on Monad, one command
├─ docs/{architecture-spec.md, THREAT-MODEL.md}
├─ turbo.json · pnpm-workspace.yaml · README.md (deployed+verified address badge)
```

- **Contracts:** Solidity ^0.8.24, Foundry (forge/anvil), OpenZeppelin (ERC20, ReentrancyGuard, Clones, Ownable).
- **Randomness:** Gelato VRF consumer (Monad testnet).
- **Chain:** Monad testnet; mock stablecoin ERC-20 (6 decimals) with faucet.
- **Frontend:** Next.js + wagmi/viem + RainbowKit, mobile-first; imports ABIs/addresses from `@bhishi/shared`.
- **Audit trail:** direct RPC event reads (`@bhishi/events`) — no standalone indexer for the sprint.

---

## 11.5 Experience layer — non-web3 UX (detailed)

**Target user:** a non-crypto person (the Indian savings-circle demographic). They must never see a seed
phrase, a gas fee, an "approve" popup, or the word "wallet." The chain is invisible plumbing.

**Wallet & signing — Privy embedded + gas sponsorship:**
- Login = email or Google via **Privy**. Privy provisions a **non-custodial embedded wallet** (key sharded,
  no seed phrase shown). This is the user's on-chain identity/address.
- Gas is **sponsored via a paymaster** so the user never holds or spends MON. Every action ("Join",
  "Contribute", "Draw") is a normal button; the sponsored tx is submitted underneath.
- **Roadmap (do not build now):** full ERC-4337 smart-contract accounts (bundler + paymaster) to batch
  `approve()`+`join()` into one signature. For the hackathon, Privy embedded wallet + paymaster-sponsored EOA
  txs is the honest, ship-able scope. Two `approve`+action steps are batched at the UI level, not 4337.

**Landing page — three entry points:**
1. **`Try demo circle` (primary CTA):** one click → Privy login → app auto-mints demo stablecoin from
   `MockStable` faucet → drops the user into a **pre-seeded 4-seat circle** where the other 3 seats are
   simulated by `scripts/demo.ts` co-members. User experiences Join → COMMIT → DRAW → PAYOUT live in
   minutes. Highest wow-per-second for judges.
2. **`Create your own` (secondary CTA):** wizard — set seats, contribution, bond (UI pre-fills the enforced
   `bond ≥ (seats−1)×contribution` and blocks under-sizing before the tx, matching the on-chain revert) →
   deploy a real clone via `CircleFactory` → share an invite link.
3. **`Join waitlist` (India off-ramp audience):** functional email capture (stored, e.g. Supabase/Formspree)
   framed honestly as *"₹ fiat off-ramp — coming soon."* This is **demand validation + a build-in-public
   asset**, NOT a live off-ramp. The off-ramp itself is roadmap (§15) and requires a licensed partner.

**UX honesty rule:** the UI must not imply the off-ramp or fiat rails exist today. Waitlist copy says
"coming soon"; the working product is the on-chain circle with testnet stablecoin.

**Frontend reads the invariants, not just forms:** the circle screen shows live state (phase, deadline,
who's committed, the audit-trail events from `@bhishi/events`) so the "you can verify everything" thesis is
visible, not buried.

---

## 12. Events (observability — the audit trail is the product)

```
CircleCreated(circleId, organizer, contribution, seats, bond, mode)
MemberJoined(circleId, member, bond)
RoundOpened(circleId, round, commitDeadline, revealDeadline)
Committed(circleId, round, member, commitment)
Revealed(circleId, round, member)
DrawRequested(circleId, round, vrfRequestId, drawRequestedAt)
WinnerDrawn(circleId, round, winner, payout)
Slashed(circleId, round, defaulter, amountRedistributed)
Stalled(circleId, round)                     // VRF timeout hit
Reclaimed(circleId, member, amount)          // permissionless unwind
FillingAborted(circleId)                     // unfilled timeout
CircleCompleted(circleId)
```

---

## 13. Demo money shots (for the 3-min video)

1. **Custody proof:** organizer calls withdraw → **transaction reverts** (no such power).
2. **Fairness proof:** DRAW runs → Gelato VRF returns → winner selected on-chain, verifiable, unriggable.
3. **Default proof:** a member skips reveal → contract **auto-slashes**, redistributes, everyone made whole.
4. **Liveness proof (the one nobody else has):** VRF never answers → after timeout, **any member** calls
   `reclaimOnStall()` → everyone recovers their funds, **no organizer, no oracle, no admin**. "Even if the
   randomness oracle dies, no one loses a cent."

---

## 14. Build order (dependency-first)

1. `MockStable` ERC-20 + faucet.
2. `Circle` skeleton (clone-safe `initialize`): create → join(bond+r0) → FILLING → ACTIVE, with
   `FILLING_TIMEOUT` + `refundFilling()`.
3. `CircleFactory` with EIP-1167 clones + `isCircle` registry + collateral-sizing revert.
4. Round FSM: COMMIT → REVEAL (commit-reveal + funding checks) + slashing on missed reveal.
5. Gelato VRF: DRAW → PAYOUT + `hasWon` accounting.
6. **`reclaimOnStall()` + STALLED path** (VRF liveness fallback).
7. Dust bucket + **conservation invariant** wired into all transitions.
8. `ReputationRegistry` + factory-gated attestation on COMPLETED.
9. Auction mode (`mode == AUCTION`) + tests.
10. Frontend flows + the four demo money shots via `scripts/demo.ts`.
11. Deploy to Monad testnet (clones), verify contracts, record demo, README badge.

**Test files map 1:1 to shots + leaks:** `Custody`, `Fairness`, `Slashing`, `ReclaimOnStall`,
`CollateralSizing`, `ConservationInv`, `WinnerDefault`, `FakeCircleAttest`, `FillingTimeout`, `Auction`.

---

## 15. Roadmap (say these openly — they build trust, not weakness)

- **Fiat ₹ off-ramp (licensed partner)** → the waitlist audience; convert circle payouts to bank/UPI for
  Indian users. Requires licensing/KYC — out of scope for the hackathon, validated via the waitlist.
- Full ERC-4337 smart-contract accounts (bundler + paymaster) → one-signature batched approve+join.
- Fiat↔stablecoin on-ramp (licensed) → serve cash-only groups like the origin-story community.
- FHE / ERC-7984 confidential contributions (Base now, Monad when a coprocessor lands).
- Proof-of-personhood (World ID / Human Passport) binding reputation to a human, not an address.
- **Payout-streaming collateral** — release the winner's payout gradually as they complete remaining rounds,
  reducing the upfront bond below `(N−1)×contribution` (the capital-efficient successor to §8's full bond).
- Idle-pool yield routing (meaningful only at large ticket / long duration).
- Streaming/partial collateral models to scale circle size honestly.
