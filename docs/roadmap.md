# Bhishi — Completion Status & Milestone Roadmap

> Companion to [`architecture-spec.md`](./architecture-spec.md) (on-chain) and
> [`production-architecture.md`](./production-architecture.md) (off-chain). This doc is the
> **living status + roadmap**: what is actually built today (verified by code review 2026-07-17),
> what remains, and the ordered milestones to reach a working testnet product and then a
> production off-chain layer.

**Decisions driving this plan:**
- **VRF operator:** fix properly — thread a real operator through the factory, run the keeper as the authorized `vrfOperator`, integrate real Gelato VRF. Draws must be trustless in prod.
- **Sequencing:** Phase A first (close frontend/on-chain gaps → working testnet dApp), then Phase B (full off-chain production layer). One ordered roadmap.

---

## Part 1 — What is COMPLETE today

### ✅ Smart contracts (`packages/contracts`) — production-complete
- **`Circle.sol`** — full ROSCA circle, both modes, clone-safe, ReentrancyGuard + SafeERC20.
  - State machine: `FILLING → COMMIT → REVEAL → DRAW → COMPLETED`, with `ABORTED_FILLING`
    (refund) and `STALLED` (reclaim) safety branches.
  - **LUCKY_DRAW**: VRF-random winner, full pot payout.
  - **AUCTION**: highest-discount-wins, 40% cap, dividend to all members, VRF tie/no-bid
    fallback, past-winner exclusion — faithfully matches real chit-fund mechanics (fee-free by
    deliberate design; documented divergence from the real 5–7% foreman commission).
  - Safety valves: `refundFilling()` (LEAK 6), `slash()` (bond default), `reclaimOnStall()` (LEAK 1).
- **`CircleFactory.sol`** — clone deploy, bond-sizing gate, `isCircle` registry.
- **`ReputationRegistry.sol`** — factory-gated, completion-gated attestation.
- **`MockStable.sol`** — testnet-only mUSDC with faucet (must be swapped for real USDC in prod).
- **Tests: 61 passing** across 16 suites, including 2 invariant/fuzz suites (256 runs × ~128k
  calls) and an economic-incentive fuzz proof.
- **Deployed on Monad testnet (chain 10143)** and **both modes proven end-to-end on-chain**
  (AUCTION + LUCKY_DRAW full lifecycles, conservation asserted every round — see README).

### ✅ Frontend (`apps/web`) — near-complete dApp shell
- Privy auth (email/google) + embedded wallets, Monad testnet configured.
- **Reads (real, viem):** dashboard circle discovery via factory `getLogs`, per-circle state,
  circle detail view, event feed. 10s polling.
- **Writes (real, wired to sign txs via embedded wallet):** `join`, `commit`, `reveal`, `claim`,
  `reclaimOnStall`, `refundFilling` — including client-side commit-hash computation.
- Early-access/waitlist form (functional UI), landing page (polished, static).

### ✅ Shared tooling (`packages/{shared,events}`)
- Real, generated ABIs for all four contracts.
- `getCircleEvents` — working `getLogs` polling helper (reusable by a future indexer).
- pnpm + Turborepo workspace; globs already accommodate new `apps/*` / `packages/*`.

---

## Part 2 — GAPS in what's already built (must fix for a working product)

### Contracts
- **G-C1 (blocker):** `CircleFactory.createCircle` hardcodes `vrfOperator = address(0)` →
  every circle runs **permissionless VRF** (anyone can submit any randomness). No setter exists.
- **G-C2:** No test sets a non-zero `vrfOperator` and asserts unauthorized-caller revert
  (`NotVrfOperator` path untested).
- **G-C3:** `eligibleCount == 0` residual `roundPool` TODO (Circle.sol:411) — recoverable via
  reclaim, but flagged for the security-audit gate; not explicitly asserted in tests.
- **G-C4:** Gelato VRF is interface-only (no coordinator call / request-id / signature
  verification); assumes an off-chain relayer.
- **G-C5:** MockStable must be replaced with canonical USDC for mainnet.

### Frontend
- **G-F1 (blocker):** `addresses.ts` is all zero-address placeholders → nothing reads/writes
  against real contracts.
- **G-F2 (blocker):** `CreateWizard.handleCreate` is a stubbed `alert()` — users cannot create a
  circle from the UI (factory ABI is present; small wiring gap).
- **G-F3 (blocker):** **No ERC-20 approval logic anywhere** — `join`/`commit`/`create` need
  mUSDC `approve`/allowance first, or every write reverts.
- **G-F4:** `lib/faucet.ts` is a `console.log` stub — no way to get testnet mUSDC from the UI.
- **G-F5:** Waitlist route only `console.log`s (no persistence); no server-side Privy verification.
- **G-F6:** Minor enum inconsistency: `CircleView` uses `ABORTED_FILLING`, `CircleCard` uses
  `ABORTED` — reconcile against the contract enum.

### Shared / events
- **G-S1:** `sync-abi.ts` **unconditionally overwrites `addresses.ts` with zeros every run** —
  will clobber real deployed addresses (the "only if not exists" comment is not implemented).
- **G-S2:** `CircleEventName` union omits `Claimed` (present in ABI); has `FillingRefunded`.
- **G-S3:** `watchCircleEvents` is a no-op stub (prefer poll-based `getCircleEvents` for the
  indexer anyway).
- **G-S4:** `@bhishi/shared` ships raw TS (`exports: ./src/index.ts`) — Node workers/api need
  tsx or a `tsc` dist build.
- **G-S5:** `getCircleEvents` lacks block-range chunking (RPC providers cap `getLogs` spans) —
  needed before production indexing.

---

## Part 3 — PHASE A: Working testnet dApp (close the gaps) — ✅ COMPLETE (2026-07-17)

Goal: a user can, from the browser, create a circle, get test funds, join, and run a full
round against live Monad testnet contracts. Ordered, each milestone independently shippable.

**Status: all four milestones done and committed.** The web app typechecks and
production-builds cleanly (8 routes); the frontend commit hash was verified byte-for-byte
against the contract's Solidity `abi.encodePacked` encoding, proving the commit/reveal
round-trip verifies on-chain. Three latent bugs were found and fixed along the way (wrong
commit-hash encoding, wrong `reveal` arity, and non-existent `claimable`/`commitOf`/`round`
getters silently masked by `.catch`).

### Milestone A1 — Deployed addresses wired in (unblocks everything)
- Fix **G-S1**: make `sync-abi.ts` preserve existing `addresses.ts` (write zeros only if missing),
  or split ABI-gen from address config entirely.
- Populate `addresses.ts` with the already-deployed Monad testnet addresses (factory
  `0x8D5EB1518fF5530f7a259582f6aFDfd530B3807C`, reputation `0x4d3d21137cF1aAa678d9e613b35409b342DE491A`,
  mockStable `0xb6600b753BDFaD238cd4e6Ca652b520F2F1fC38c`).
- Set `NEXT_PUBLIC_DEMO_CIRCLE_ADDRESS` to a live seeded circle.
- **Acceptance:** dashboard shows real circles; circle detail reads live state.

### Milestone A2 — ERC-20 approval + faucet (unblocks all writes)
- Add mUSDC `approve`/allowance logic (a reusable hook) before `join`/`commit`/`create`.
- Wire `lib/faucet.ts` to call `MockStable.faucet()` (G-F4).
- **Acceptance:** a funded user can approve and `join`/`commit` without reverts.

### Milestone A3 — Wire circle creation
- Replace `CreateWizard` alert stub (G-F2) with a real `CircleFactory.createCircle` tx (+approval),
  then redirect to the new circle. Keep the existing bond-gate validation.
- **Acceptance:** user creates a circle from the UI; it appears on their dashboard.

### Milestone A4 — Polish & correctness
- Reconcile state-enum labels (G-F6); fix `CircleEventName` (G-S2).
- Optional: replace landing-page fabricated figures with a live "circles created / total pooled"
  stat read from the factory.
- **Acceptance:** full happy path (create → fund → join → commit → reveal → draw → claim) works
  end-to-end on testnet from the browser, with permissionless VRF draw for now.

**At end of Phase A:** a demoable, fully-functional testnet product. VRF is still permissionless
(hardened in Phase B, M-B4).

---

## Part 4 — PHASE B: Production off-chain layer — ✅ BUILT (2026-07-17)

Follows the `production-architecture.md` design. Each milestone independently shippable; order
front-loads the pieces the product needs earliest.

**Status: all milestones built and committed.** Everything was verified against *real*
infrastructure — live Postgres, live Redis, live Monad testnet — not just compiled.

| Milestone | Status | Evidence |
|---|---|---|
| B0 VRF hardening | ✅ | operator threaded through factory; unauthorized fulfil reverts (proved on-chain: `0x11314cbe` = `keccak("NotVrfOperator()")`) |
| B1 `packages/db` | ✅ | migration applied to real Postgres; 7 tables; idempotent `(txHash, logIndex)` proved (same event twice → 1 row) |
| B2 `apps/api` | ✅ | booted live: `/api/health` 200 w/ real DB probe; waitlist persists; `walletAddress` injection rejected 400 |
| B3 indexer + indexed reads | ✅ | reconstructed the real deployed circle from chain after a full DB wipe; served via `GET /api/circles` |
| B4 **Pyth Entropy** (replaced Gelato) | ✅ | circle sponsors the fee from its own balance; 75/75 tests incl. a member-pays-nothing assertion |
| B5 notify worker | ✅ | messages flowed through live Redis → `NotificationLog` 'sent'; dedupe proved (3 enqueues → 1 row) |
| B6 CI + infra | ✅ | `docker compose config` valid (5 services); CI covers contracts/web/workers/api |

**Deviations from the original plan, and why:**
- **B4 is Pyth Entropy, not Gelato.** Gelato's VRF app is deprecated, VRF is absent from its
  replacement platform, and it gates testnet behind a subscription + a non-refundable Gas Tank.
  Pyth is verified live on Monad testnet and fits the clone-per-circle model.
- **No VRF keeper worker exists, by design.** Both Gelato and Pyth are *callback* systems — their
  own nodes deliver randomness. The plan's "keeper calls the VRF API" step was based on a
  misreading; there is no such API.
- **Fee sponsorship was added** (not in the original plan): the circle pre-pays Entropy from its
  own MON balance so members never spend native tokens.

**Still open (needs the user):** testnet gas to redeploy with Pyth wired in, and the zero-MON
end-to-end test that proves gasless (see `gasless-plan.md`).

### Milestone B0 — Contract hardening for real VRF (do first; requires redeploy)
- Fix **G-C1**: add `vrfOperator` param to `createCircle` → thread through `initialize`.
- Add **G-C2** test: non-zero operator + unauthorized-caller revert.
- Address **G-C3** (assert residual-pool recovery) at the security-audit gate.
- Redeploy factory to testnet with the keeper's address as operator; re-run lifecycle proofs.
- **Acceptance:** factory-created circles reject unauthorized `fulfillRandomness`; keeper is the
  sole authorized operator.

### Milestone B1 — `packages/db` (Prisma)
- Prisma schema per the doc (Circle, Member, Round, ChainEvent, WaitlistEntry, NotificationLog),
  migrations, generated client. Fix **G-S4** (dist build or tsx for Node consumers).
- **Acceptance:** `packages/db` importable by api + workers; migrations apply.

### Milestone B2 — `apps/api` (NestJS) + waitlist persistence
- `HealthModule`, `WaitlistModule` (persist to Postgres, replace the `console.log` route, G-F5),
  `AuthModule` (server-side Privy JWT verification).
- Point the frontend waitlist at the real API.
- **Acceptance:** waitlist entries persist; protected routes verify Privy tokens.

### Milestone B3 — Indexer worker + `CirclesModule`
- Indexer polls factory + clones via `getCircleEvents` (add block-range chunking, G-S5), upserts
  idempotently into Postgres.
- `CirclesModule` serves `GET /circles`, `/circles/:address`, `/circles/:address/events` from
  Postgres; migrate the dashboard/circle-view off raw client `getLogs` to the indexed API (keep
  viem reads only for real-time tx status).
- **Acceptance:** dashboard loads from the indexed API; Postgres reconstructable from genesis.

### Milestone B4 — VRF keeper worker (authorized operator)
- Keeper worker holds the scoped operator key (from B0), watches for rounds entering `DRAW`,
  calls Gelato VRF request, submits `fulfillRandomness` with idempotency guard + backoff.
- Real Gelato VRF integration (G-C4): coordinator call, request-id tracking.
- **Acceptance:** draws happen automatically and are trustless; keeper death → contract
  `VRF_TIMEOUT`/`reclaimOnStall` still protects funds.

### Milestone B5 — Notify worker + reminders
- Notify worker (WhatsApp/email), reminder scheduling (deadline − 6h delayed jobs), Redis/BullMQ
  queues + read cache.
- **Acceptance:** deadline reminders and payout/slash notices delivered; logged for dedup/audit.

### Milestone B6 — Infra + CI/CD + observability
- `infra/` Docker Compose (api, 3 workers, postgres, redis), Dockerfiles.
- CI (`turbo run lint typecheck test build` + `forge test`); CD (build/push images, migrate,
  deploy). Add missing turbo tasks (typecheck/db/start/lint).
- Structured logs (pino) + alerts (keeper failures, VRF-timeout risk, indexer lag).
- **Acceptance:** green CI blocks merges; one-command deploy; keeper failures alert.

---

## Part 5 — Pre-mainnet gate (not a near-term milestone)
- Replace MockStable with canonical USDC (G-C5); re-check decimals per chain.
- Full security audit (the M6 gate); resolve G-C3 formally.
- Decide on admin/upgrade posture (currently fully trustless, no pause/upgrade by design).
- Gas re-profiling before ever raising `MAX_SEATS` above 20.

---

## Suggested immediate next step
Start **Phase A** with **Milestone A1** (wire deployed addresses + fix the sync-abi clobber) —
it's small, unblocks all reads, and makes the already-built frontend come alive against the
contracts we've already deployed and proven.
