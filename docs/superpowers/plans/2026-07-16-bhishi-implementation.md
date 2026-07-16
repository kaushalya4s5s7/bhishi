# Bhishi Implementation Plan

> **For Claude:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking. Contracts are TDD-first: every leak/money-shot gets a failing test before implementation.

**Goal:** Ship Bhishi — a non-custodial, verifiably-fair, liveness-safe savings circle on Monad testnet — from empty repo to a deployed+verified demo with a non-web3 (Privy) frontend and four provable money shots, before 2026-07-19 23:59 UTC.

**Architecture:** pnpm + Turborepo monorepo. `packages/contracts` (Foundry) holds the moat; `packages/shared` publishes generated ABIs/addresses/types as the single source of truth; `packages/events` reads the audit trail via RPC; `apps/web` (Next.js + Privy embedded wallets + gas sponsorship) surfaces the invariants. `scripts/demo.ts` drives all four money shots live. Full design in `docs/architecture-spec.md`; adversary analysis in `docs/THREAT-MODEL.md`.

**Tech Stack:** Solidity ^0.8.24, Foundry (forge/anvil), OpenZeppelin (ERC20, ReentrancyGuard, Clones), Gelato VRF, Monad testnet; Next.js 14, wagmi/viem, Privy (embedded wallet + paymaster), TypeScript; pnpm, Turborepo.

**Timeline (3.5 days):** M0–M6 = contracts (Day 1–2), M7 = shared/events (Day 2), M8–M10 = frontend (Day 2–3), M11 = deploy+demo+content (Day 3–4). Contracts are the moat; if time compresses, cut auction-mode UI and create-wizard polish before cutting any invariant test.

---

## File structure (locked before tasks)

```
bhishi/
├─ package.json · pnpm-workspace.yaml · turbo.json · .env.example · README.md
├─ docs/{architecture-spec.md, THREAT-MODEL.md, superpowers/plans/...}
├─ packages/
│  ├─ contracts/
│  │  ├─ foundry.toml · remappings.txt · .env.example
│  │  ├─ src/
│  │  │  ├─ CircleFactory.sol      # clones + isCircle registry + bond-sizing gate
│  │  │  ├─ Circle.sol             # escrow + FSM + VRF consumer + reclaim paths
│  │  │  ├─ ReputationRegistry.sol # factory-gated positive attestation
│  │  │  ├─ MockStable.sol         # 6-dec ERC-20 + faucet
│  │  │  └─ interfaces/{IYieldAdapter.sol, IGelatoVRFConsumer.sol}
│  │  ├─ test/                     # one file per money-shot / leak (see M1–M6)
│  │  │  └─ mocks/{MockVRF.sol, ReentrantToken.sol, FakeCircle.sol}
│  │  └─ script/{Deploy.s.sol, SeedDemo.s.sol}
│  ├─ shared/                      # @bhishi/shared: abis/, addresses.ts, types (generated)
│  │  ├─ src/{index.ts, addresses.ts}  · scripts/sync-abi.ts · package.json
│  └─ events/                      # @bhishi/events: RPC event reader
│     ├─ src/{index.ts, watchers.ts} · package.json
├─ apps/web/                       # Next.js app
│  ├─ app/{page.tsx, demo/page.tsx, create/page.tsx, circle/[id]/page.tsx, api/waitlist/route.ts}
│  ├─ components/{TryDemoButton, CreateWizard, WaitlistForm, CircleView, PhaseBadge, EventFeed}
│  ├─ lib/{privy.ts, contracts.ts, faucet.ts}
│  └─ providers.tsx
└─ scripts/demo.ts                 # four money shots, live on Monad
```

**Decomposition rule:** `Circle.sol` is the one large file (state machine + escrow). Keep everything else small and single-purpose. If `Circle.sol` exceeds ~400 lines, split pure math (bond sizing, dust, conservation) into a `CircleMath` library.

---

## Chunk 1: Contracts (M0–M6)

### Milestone M0 — Repo + Foundry skeleton

**Files:** Create `pnpm-workspace.yaml`, `turbo.json`, root `package.json`, `packages/contracts/foundry.toml`, `remappings.txt`.

- [ ] **Step 1: Scaffold monorepo**

```bash
mkdir -p bhishi && cd bhishi
git init
corepack enable && pnpm init
# pnpm-workspace.yaml:  packages: ["apps/*", "packages/*"]
mkdir -p packages/contracts apps/web packages/shared packages/events scripts docs
```

- [ ] **Step 2: Init Foundry + deps**

```bash
cd packages/contracts
forge init --no-git --no-commit .
forge install OpenZeppelin/openzeppelin-contracts --no-commit
# remappings.txt: @openzeppelin/=lib/openzeppelin-contracts/
```

- [ ] **Step 3: Verify toolchain**

Run: `forge build`
Expected: compiles the default `Counter.sol`. Then delete `src/Counter.sol`, `test/Counter.t.sol`, `script/Counter.s.sol`.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore: scaffold monorepo + foundry"
```

**Acceptance:** `forge build` succeeds in `packages/contracts`; workspace recognized by `pnpm -r list`.

---

### Milestone M1 — MockStable (faucet stablecoin)

**Files:** Create `src/MockStable.sol`, `test/MockStable.t.sol`.

- [ ] **Step 1: Write the failing test**

```solidity
// test/MockStable.t.sol
import {Test} from "forge-std/Test.sol";
import {MockStable} from "../src/MockStable.sol";

contract MockStableTest is Test {
    MockStable stable;
    function setUp() public { stable = new MockStable(); }

    function test_decimalsIsSix() public view { assertEq(stable.decimals(), 6); }

    function test_faucetMintsToCaller() public {
        vm.prank(address(0xBEEF));
        stable.faucet();
        assertEq(stable.balanceOf(address(0xBEEF)), 500 * 1e6);
    }

    function test_faucetCooldownReverts() public {
        vm.startPrank(address(0xBEEF));
        stable.faucet();
        vm.expectRevert(MockStable.FaucetCooldown.selector);
        stable.faucet();
    }
}
```

- [ ] **Step 2: Run test to verify it fails** — `forge test --match-contract MockStableTest` → FAIL (no MockStable).
- [ ] **Step 3: Implement** `MockStable` = OZ ERC20 (6 decimals via override) + `faucet()` minting 500e6 with a per-address cooldown mapping and `FaucetCooldown` error.
- [ ] **Step 4: Run test** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(contracts): MockStable faucet ERC-20 (6 decimals)"`

**Acceptance:** faucet mints 500 mUSDC, enforces cooldown, decimals == 6.

---

### Milestone M2 — CircleFactory: clones + isCircle registry + bond-sizing gate (LEAK 2, 4, 5)

**Files:** Create `src/CircleFactory.sol`, minimal `src/Circle.sol` stub with `initialize(...)`, `test/CircleFactory.t.sol`.

- [ ] **Step 1: Write the failing tests**

```solidity
// test/CircleFactory.t.sol — key cases
function test_createCircleDeploysCloneAndRegisters() public {
    address c = factory.createCircle(CONTRIB, SEATS, VALID_BOND, Mode.LUCKY_DRAW);
    assertTrue(factory.isCircle(c));
    assertTrue(c.code.length > 0);
}
function test_underSizedBondReverts() public {          // LEAK 2 enforced at creation
    uint256 tooLow = (SEATS - 1) * CONTRIB - 1;
    vm.expectRevert(CircleFactory.BondTooLow.selector);
    factory.createCircle(CONTRIB, SEATS, tooLow, Mode.LUCKY_DRAW);
}
function test_isCircleFalseForRandomAddress() public {  // LEAK 4 foundation
    assertFalse(factory.isCircle(address(0xDEAD)));
}
function test_clonesHaveIsolatedStorage() public {      // LEAK 5 isolation
    address a = factory.createCircle(CONTRIB, SEATS, VALID_BOND, Mode.LUCKY_DRAW);
    address b = factory.createCircle(CONTRIB, SEATS, VALID_BOND, Mode.LUCKY_DRAW);
    assertTrue(a != b);
}
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** — `CircleFactory` holds an immutable `Circle` implementation address; `createCircle` uses `Clones.clone(impl)`, calls `Circle.initialize(...)`, requires `bond >= (seats-1)*contribution` else `BondTooLow`, records `isCircle[clone]=true`, emits `CircleCreated`. `Circle` stub: clone-safe `initialize` guarded by an `initialized` flag (no constructor state).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(contracts): CircleFactory clones + bond-sizing gate + registry"`

**Acceptance:** under-sized circle cannot deploy; clones isolated; registry answers `isCircle` correctly.

---

### Milestone M3 — Circle FSM: join → FILLING → ACTIVE + FILLING_TIMEOUT refund (LEAK 6)

**Files:** Modify `src/Circle.sol`, create `test/Filling.t.sol`, `test/FillingTimeout.t.sol`.

- [ ] **Step 1: Write failing tests**

```solidity
// join stakes bond + round-0 contribution, transitions FILLING→ACTIVE when full
function test_joinFillsSeatsThenActivates() public { /* N members join → state == ACTIVE */ }
function test_joinTwiceReverts() public { /* same address second join → revert */ }
function test_joinRequiresBondPlusContribution() public { /* underfunded approve → revert */ }
// LEAK 6:
function test_refundFillingAfterTimeoutReturnsBond() public {
    // 2 of 4 join, warp past FILLING_TIMEOUT, anyone calls refundFilling()
    // each joiner recovers exactly bond + contribution; state == ABORTED_FILLING
}
function test_refundFillingBeforeTimeoutReverts() public { vm.expectRevert(); /* too early */ }
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `join()` (pull `bond + contribution` via `transferFrom`, record member, flip to ACTIVE on last seat, set round deadlines), `refundFilling()` (permissionless after `startedAt + FILLING_TIMEOUT` while still FILLING; return each member's staked funds; state → ABORTED_FILLING). CEI + `nonReentrant`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(contracts): Circle join/FILLING + permissionless filling-timeout refund"`

**Acceptance:** full seats → ACTIVE; unfilled + timeout → every joiner recovers funds permissionlessly.

---

### Milestone M4 — Round FSM: COMMIT → REVEAL + slashing on missed reveal (LEAK 3 partial)

**Files:** Modify `src/Circle.sol`, create `test/CommitReveal.t.sol`, `test/Slashing.t.sol`.

- [ ] **Step 1: Write failing tests**

```solidity
// commit-reveal correctness
function test_commitThenValidRevealAccepted() public { /* keccak256(amount,salt,member) matches */ }
function test_invalidRevealReverts() public { vm.expectRevert(); /* wrong salt */ }
// SLASHING (money shot 3):
function test_missedRevealIsSlashed_winnerMadeWhole() public {
    // N members, 1 skips reveal past deadline → slash():
    //  - defaulter.bond tops up shorted round pool FIRST (winner made whole)
    //  - remainder redistributed pro-rata to compliant members
    //  - defaulter marked removed
    // assert: round pool == full N*contribution equivalent; defaulter.claimable == 0
}
function test_slashRemainderGoesToDustBucket() public { /* LEAK 3: dust deterministic, not trapped */ }
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** COMMIT (store `commitment`, pull contribution), REVEAL (verify hash + funded amount), `slash()` (callable after reveal deadline for any un-revealed member; top-up-then-redistribute; integer-division remainder → `dustAccrued`). CEI + `nonReentrant`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(contracts): commit-reveal rounds + auto-slash with dust bucket"`

**Acceptance:** missed reveal auto-slashes; winner made whole; no dust trapped.

---

### Milestone M5 — VRF draw → PAYOUT + reclaimOnStall (LEAK 1, money shots 2 & 4)

**Files:** Modify `src/Circle.sol`, create `test/mocks/MockVRF.sol`, `test/Fairness.t.sol`, `test/ReclaimOnStall.t.sol`, `test/Custody.t.sol`.

- [ ] **Step 1: Write failing tests**

```solidity
// MONEY SHOT 2 — fairness
function test_winnerSetOnlyByVrfFulfil() public { /* only fulfillRandomness sets hasWon */ }
function test_organizerCannotInfluenceWinner() public { vm.expectRevert(); /* no such fn */ }
function test_winnerExcludesPriorWinners() public { /* run N rounds, each winner unique */ }
// MONEY SHOT 1 — custody (put here, needs a live pool)
function test_organizerWithdrawReverts() public { vm.expectRevert(); /* no withdraw path */ }
// MONEY SHOT 4 — liveness (LEAK 1)
function test_reclaimOnStallAfterVrfTimeout() public {
    // DRAW requested, VRF never fulfils, warp past VRF_TIMEOUT
    // each member calls reclaimOnStall() → recovers current contribution + remaining bond
    // state == STALLED; sum of reclaims == contract balance (conserved)
}
function test_reclaimBeforeTimeoutReverts() public { vm.expectRevert(); }
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `requestDraw()` (records `drawRequestedAt`, `vrfRequestId`; anyone can trigger after reveal deadline — no organizer gate), `fulfillRandomness(id, rand)` (VRF-operator-only; `winnerIdx = rand % remaining.length`; set `hasWon`, transfer pool, advance round or COMPLETED), `reclaimOnStall()` (permissionless after `drawRequestedAt + VRF_TIMEOUT`; state → STALLED; per-member exact recovery). Use `MockVRF` in tests to simulate both fulfilment and silence. CEI + `nonReentrant`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(contracts): VRF draw/payout + permissionless reclaim-on-stall"`

**Acceptance:** winner only via VRF; organizer withdraw reverts; VRF silence → everyone reclaims, funds conserved.

---

### Milestone M6 — Invariants + reputation + hardening (LEAK 2, 3, 4 proofs)

**Files:** Create `test/ConservationInv.t.sol`, `test/WinnerDefault.t.sol`, `test/FakeCircleAttest.t.sol`; create `src/ReputationRegistry.sol`, `test/mocks/{ReentrantToken.sol, FakeCircle.sol}`; modify `Circle.sol` to attest on COMPLETED.

- [ ] **Step 1: Write failing tests**

```solidity
// LEAK 3 — conservation invariant (fuzz)
function invariant_balanceEqualsClaims() public view {
    assertEq(stable.balanceOf(address(circle)),
             circle.totalClaimable() + circle.dustAccrued() + circle.undrawnPools());
}
// LEAK 2 — winner default is never profitable (fuzz over win-round & default-round)
function testFuzz_defaultAfterWinIsUnprofitable(uint8 winRound, uint8 defaultRound) public { /* net <= 0 */ }
// LEAK 4 — sham circle cannot attest
function test_fakeCircleAttestReverts() public {
    FakeCircle fake = new FakeCircle(reputation);
    vm.expectRevert(ReputationRegistry.NotFactoryCircle.selector);
    fake.tryAttest(address(0xBEEF), 1);
}
function test_completedCircleWritesAttestation() public { /* real circle → attest succeeds once */ }
// reentrancy harness
function test_reentrantTokenCannotDoubleWithdraw() public { /* ReentrantToken during payout → safe */ }
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `ReputationRegistry.attest` (requires `factory.isCircle(msg.sender)` + caller COMPLETED, once per member, `NotFactoryCircle` error); wire `Circle` to call it on COMPLETED and return bonds + release dust; add invariant test harness (`totalClaimable`, `undrawnPools`, `dustAccrued` view helpers).
- [ ] **Step 4: Run** — `forge test` (all) → PASS; `forge test --match-test invariant` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(contracts): conservation invariant + factory-gated reputation + hardening"`

**Acceptance:** `forge test` green; conservation + winner-default fuzz invariants hold; fake circle can't mint reputation.

**GATE — security pass:** dispatch `agent-skills:security-auditor` on `src/Circle.sol` + `CircleFactory.sol` before deploy. Fix findings, re-run `forge test`.

---

## Chunk 2: Shared + Events + Frontend (M7–M10)

### Milestone M7 — @bhishi/shared: ABI/address/type single source

**Files:** Create `packages/shared/{package.json, src/index.ts, src/addresses.ts, scripts/sync-abi.ts}`.

- [ ] **Step 1:** Write `scripts/sync-abi.ts` — reads `packages/contracts/out/*.sol/*.json`, writes `src/abis/*.json` + re-exports typed via `viem`'s `Abi`. `addresses.ts` = `{ monadTestnet: { factory, reputation, mockStable } }` filled at deploy.
- [ ] **Step 2:** Add `postbuild` hook in contracts (`forge build && pnpm --filter @bhishi/shared sync`).
- [ ] **Step 3: Verify** — `pnpm --filter @bhishi/shared build` emits ABIs; `import { circleFactoryAbi } from "@bhishi/shared"` resolves in a scratch TS file.
- [ ] **Step 4: Commit** — `git commit -m "feat(shared): generated ABIs/addresses/types single source"`

**Acceptance:** frontend + events both import from `@bhishi/shared`; no hand-copied ABIs.

---

### Milestone M8 — @bhishi/events: RPC audit-trail reader

**Files:** Create `packages/events/{package.json, src/index.ts, src/watchers.ts}`.

- [ ] **Step 1:** Implement `viem` `getLogs`/`watchContractEvent` wrappers for `RoundOpened, Committed, Revealed, DrawRequested, WinnerDrawn, Slashed, Stalled, Reclaimed, CircleCompleted` → normalized `CircleEvent[]`.
- [ ] **Step 2: Verify** against a locally-deployed anvil circle: emit events via a forge script, assert the reader returns them ordered.
- [ ] **Step 3: Commit** — `git commit -m "feat(events): RPC audit-trail reader"`

**Acceptance:** feed returns a chronologically ordered event list for a circle address.

---

### Milestone M9 — apps/web: Privy + landing (waitlist + try-it entry points)

**Files:** Create `apps/web` (Next.js 14 app router), `providers.tsx`, `lib/privy.ts`, `lib/contracts.ts`, `lib/faucet.ts`, `app/page.tsx`, `components/{WaitlistForm, TryDemoButton}`, `app/api/waitlist/route.ts`.

- [ ] **Step 1:** Scaffold Next.js (`pnpm create next-app`), add `@privy-io/react-auth`, `wagmi`, `viem`, `@bhishi/shared`. Configure Privy: embedded wallets on login, Monad testnet chain, **paymaster/gas sponsorship** config. Env in `.env.example` (`NEXT_PUBLIC_PRIVY_APP_ID`, RPC, paymaster URL).
- [ ] **Step 2:** Landing `page.tsx` — hero + three CTAs: **Try demo circle** (primary), **Create your own** (secondary), **Join waitlist** (email). `WaitlistForm` → `POST /api/waitlist` → store lead (Supabase/Formspree), copy = "₹ off-ramp coming soon."
- [ ] **Step 3:** `TryDemoButton` — Privy login → call `MockStable.faucet()` (sponsored) → route to `/demo`.
- [ ] **Step 4: Verify** — `pnpm --filter web dev`; login with email creates an embedded wallet (no seed phrase shown); waitlist stores an email; faucet mints without user paying gas.
- [ ] **Step 5: Commit** — `git commit -m "feat(web): Privy embedded wallet + landing (waitlist + try-it CTAs)"`

**Acceptance:** non-web3 email login → wallet + testnet stablecoin, zero gas prompts; waitlist captures leads.

---

### Milestone M10 — apps/web: demo circle + create wizard + circle view

**Files:** Create `app/demo/page.tsx`, `app/create/page.tsx`, `app/circle/[id]/page.tsx`, `components/{CreateWizard, CircleView, PhaseBadge, EventFeed}`.

- [ ] **Step 1:** `CircleView` — reads circle state + `@bhishi/events` feed; `PhaseBadge` shows COMMIT/REVEAL/DRAW/PAYOUT + deadline; action button contextual (Join / Contribute / Reveal / Draw), all sponsored txs. `EventFeed` renders the audit trail (thesis made visible).
- [ ] **Step 2:** `app/demo` — join the pre-seeded circle (other seats simulated by `scripts/demo.ts`); user walks Join → contribute → watch draw.
- [ ] **Step 3:** `CreateWizard` — seats/contribution/bond fields; **UI enforces `bond ≥ (seats−1)×contribution` before submit** (mirror the on-chain revert); on submit deploy via `CircleFactory`, show invite link.
- [ ] **Step 4: Verify** — end-to-end on testnet: create a circle, join from a 2nd Privy account, run a round; demo route completes a draw visibly.
- [ ] **Step 5: Commit** — `git commit -m "feat(web): demo circle, create wizard, live circle view + event feed"`

**Acceptance:** a judge can Try demo and see a full round + draw; create-wizard blocks under-sized bonds pre-tx.

---

## Chunk 3: Deploy, demo, ship (M11)

### Milestone M11 — Monad deploy + demo.ts (four money shots) + README

**Files:** Create `script/Deploy.s.sol`, `script/SeedDemo.s.sol`, `scripts/demo.ts`, `README.md`.

- [ ] **Step 1:** `Deploy.s.sol` — deploy `MockStable`, `ReputationRegistry`, `Circle` implementation, `CircleFactory(impl, reputation)`; write addresses into `@bhishi/shared/addresses.ts`. Deploy to Monad testnet; `forge verify-contract` all.
- [ ] **Step 2:** `SeedDemo.s.sol` — create the pre-seeded 4-seat demo circle; fund simulated co-members.
- [ ] **Step 3:** `scripts/demo.ts` — one command runs, live on Monad, printing ✓ per shot:
  1. `organizer.withdraw()` → catches revert → **✓ CUSTODY**
  2. round → `requestDraw` → Gelato VRF fulfils → **✓ FAIRNESS** (print winner)
  3. member skips reveal → `slash()` → assert winner made whole → **✓ DEFAULT**
  4. new round → VRF withheld → warp/wait `VRF_TIMEOUT` → `reclaimOnStall()` → assert all recovered → **✓ LIVENESS**
- [ ] **Step 4: Verify** — `pnpm demo` prints all four ✓ against live testnet; contracts show verified on explorer.
- [ ] **Step 5:** `README.md` — hero (thesis), verified address badge, "run `pnpm demo`", link to `THREAT-MODEL.md`, the four money shots up top.
- [ ] **Step 6: Commit + tag** — `git commit -m "feat: Monad deploy + four-money-shot demo + README"` then `git tag v1.0-hackathon`.

**GATE — pre-submission:** run `agent-skills:ship` for a go/no-go. Record the 90-sec demo video. Submit before 2026-07-19 23:59 UTC.

**Acceptance:** verified contracts on Monad testnet; `pnpm demo` proves all four shots live; frontend demo works end-to-end for a fresh non-web3 user.

---

## Scope-cut order (if time compresses — cut top-down, never cut an invariant test)

1. Auction mode UI (keep `AuctionMode.t.sol` — contract-level proof only).
2. Create-wizard polish (keep Try-demo path).
3. `EventFeed` styling (keep raw list).
4. Waitlist niceties (keep basic capture).
5. NEVER cut: Custody / Fairness / Slashing / ReclaimOnStall / Conservation / WinnerDefault / FakeCircleAttest tests, or the four `pnpm demo` shots. Those are the moat.

---

## Definition of done

- `forge test` green, including `invariant_*` and fuzz tests.
- Contracts deployed + verified on Monad testnet; addresses in `@bhishi/shared`.
- `pnpm demo` prints ✓ CUSTODY / ✓ FAIRNESS / ✓ DEFAULT / ✓ LIVENESS against live testnet.
- Fresh non-web3 user: email login → embedded wallet → faucet → join demo circle → see a draw, never touching gas or a seed phrase.
- `README.md` + `THREAT-MODEL.md` present; 90-sec video recorded; submitted before deadline.
