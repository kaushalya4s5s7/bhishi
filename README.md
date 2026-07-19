# Bhishi — Non-Custodial Savings Circle on Monad

> *"Trust the math, not the person."*

[![Monad Testnet](https://img.shields.io/badge/Monad-Testnet-7C3AED)](https://testnet.monadexplorer.com)

## The Tradition

One of the world's oldest financial instruments needs no bank: a group of people
who trust each other pool a fixed amount every month, and each month **one member
takes the whole pot** — rotating until everyone has had a turn. Interest-free
credit and forced savings in one, centuries old, running on nothing but
neighborhood trust. Every community independently invented it:

**Bhishi** (Maharashtra) · **Chit fund** (South India) · **Committee/Kameti**
(North India, Pakistan) · **Tanda** (Mexico) · **Susu** (Ghana, Caribbean) ·
**Hui** (China, Vietnam) · **Gam'eya** (Egypt) · **Stokvel** (South Africa) ·
academics call it a **ROSCA** — Rotating Savings and Credit Association.

## The Problem — why the tradition is dying

The whole design rests on one thing: **everyone must personally trust one
organizer and every other member.** That's exactly what's breaking:

1. **Custody risk** — the organizer physically holds the pot. If they vanish, the
   money is gone. High-profile chit-fund scams have burned entire communities and
   made "chit fund" a dirty word for a generation.
2. **Favoritism** — the organizer decides who gets the pot when. Draws happen
   behind closed doors; the organizer's cousin somehow wins first.
3. **Default with no teeth** — a member who already took the pot stops paying.
   The only enforcement is social pressure, and everyone after them gets less.
4. **The locality ceiling** — trust = geography. The circle only works with people
   whose doors you can knock on. Move to a city, join the diaspora, and your trust
   network is gone — which is why the young generation, who'd benefit most, never
   joins. The tradition isn't dying because the idea is bad; it's dying because
   **trust doesn't travel.**
5. **No records** — cash and a notebook. Disputes are unresolvable, so one
   argument kills a circle.

## The Solution — what we built, problem by problem

Keep the tradition exactly as it is — same pot, same rotation, same monthly
rhythm — and replace the one thing that's failing: move the trust from the
organizer's character to collateral and code.

| Tradition's failure | What Bhishi builds instead | Proof |
|---|---|---|
| Organizer holds the pot | **Nobody does.** Funds sit in a per-circle escrow contract with **no withdraw function** — not even for us | ✓ **CUSTODY** — `withdraw()` reverts: the function doesn't exist |
| Organizer picks winners | **No human picks.** Winner comes from [Pyth Entropy](https://docs.pyth.network/entropy) drand randomness (lucky-draw) or a sealed-bid auction settled on-chain | ✓ **FAIRNESS** — every draw's fulfilment tx is sent by Pyth's keeper, [verifiable below](#verifiable-randomness--proven-on-chain) |
| Defaulters face only social pressure | **Defaulters lose real money.** Every member locks a bond up front; miss a payment and it's **auto-slashed** — pot topped up, remainder paid to the honest members. Past winners keep paying every round, and are slashable like anyone else | ✓ **DEFAULT** — slash flow proven in tests + live; winner still made whole |
| Trust can't travel beyond the neighborhood | **The bond IS the trust.** You can circle with people you've never met — an invite link, email login (embedded wallets, no crypto knowledge needed), gas sponsored. On-time members build a portable on-chain **reputation score** that follows them to the next circle | ReputationRegistry — attested on completion, [fake circles can't mint it](#deployed-contracts-monad-testnet) |
| Cash + notebook, disputes unresolvable | **Every action is a transaction.** Join, payment, bid, draw, payout — all on-chain, all linked in the app's activity feed. And if the infrastructure itself ever dies mid-round, **any member** can reclaim the funds — no one to beg | ✓ **LIVENESS** — permissionless `reclaimOnStall()` after VRF timeout |

Every ✓ above is not a promise — each one is proven by transactions on Monad
testnet you can click and verify in the sections below.

## Deployed Contracts (Monad Testnet)

Live on Monad testnet (chain `10143`), wired to **real Pyth Entropy** for verifiable
randomness. This is the **Design A** deployment (2026-07-19) — every member, including
past round winners, pays their contribution every round, so the pot never shrinks
mid-circle. Click any address to open it in the explorer.

| Contract | Role — when it's called, and by whom | Address |
|----------|--------------------------------------|---------|
| **CircleFactory** | You call it **once per circle**: `createCircle()` deploys a clone + registers it. The only address a user ever sends a "create" tx to. | [`0x4196BBaAB023458678379DDa68c5093e2c046D48`](https://testnet.monadexplorer.com/address/0x4196BBaAB023458678379DDa68c5093e2c046D48) |
| **Circle** (implementation) | **Never called directly.** Holds the logic once; every circle clone `DELEGATECALL`s into it. Its own storage is empty and locked (`initialized = true`). → [how this works](#one-implementation-many-circles-the-delegatecall-model) | [`0xbffecAADE520A17a6728aC8cDc2A1e7F60266A74`](https://testnet.monadexplorer.com/address/0xbffecAADE520A17a6728aC8cDc2A1e7F60266A74) |
| **Circle clone** (one per circle) | **Where your money lives.** Holds the pot, bonds and all state; you join/commit/reveal/claim here. Address is in the page URL (`/circle/0x…`). | e.g. [`0xc2796791…81E2e`](https://testnet.monadexplorer.com/address/0xc27967918b15232f95b3bac464ed43a36c181e2e) |
| **ReputationRegistry** | **Zero direct txs by design.** A clone calls `attest()` *internally* when it hits COMPLETED, +1 score per member. Gated: non-circles revert `NotFactoryCircle()`. | [`0xEfAc337fD02F1060f7763C7a213feb0AC2B12068`](https://testnet.monadexplorer.com/address/0xEfAc337fD02F1060f7763C7a213feb0AC2B12068) |
| **MockStable** (mUSDC) | Test stablecoin + free faucet. **Reused** across the redeploy so existing balances stayed valid. | [`0xDc97E76aC1e5F1Ce0488Ad07a139e2632Bd1487a`](https://testnet.monadexplorer.com/address/0xDc97E76aC1e5F1Ce0488Ad07a139e2632Bd1487a) |
| **Pyth Entropy** (external) | Its keeper calls **into** the clone with drand randomness to settle each draw. Not ours — that's the point. | [`0x825c0390f379C631f3Cf11A82a37D20BddF93c07`](https://testnet.monadexplorer.com/address/0x825c0390f379C631f3Cf11A82a37D20BddF93c07) |

> **Prior deployment:** circles created before 2026-07-19 live on the previous factory
> (`0x384597AE10181bC7215f4a57aF6caAe1a6eE26dc`) and keep running on the pre-Design-A
> contract until they complete or stall — they are not migrated. See
> [docs/LEGACY_README_NOTES.md](docs/LEGACY_README_NOTES.md) for the full history of
> what changed and why, including the shrinking-pot bug Design A fixes.

### One implementation, many circles — the DELEGATECALL model

Deploying full circle logic per circle would cost ~11.5 KB of bytecode every time. Instead
the logic is deployed **once** (the implementation above) and each circle is a **45-byte
[EIP-1167](https://eips.ethereum.org/EIPS/eip-1167) minimal proxy** that `DELEGATECALL`s
into it — cheap to create, and every clone gets **isolated storage**.

The clone's entire on-chain bytecode, with the implementation address baked in:

```
0x363d3d373d3d3d363d73 bffecaade520a17a6728ac8cdc2a1e7f60266a74 5af43d82803e903d91602b57fd5bf3
                       └── implementation address ──────────────┘ └─ 5a f4 = GAS, DELEGATECALL
```

**What this means in practice**

| | Implementation `0xbffe…6A74` | Clone `0xc279…81E2e` |
|---|---|---|
| Bytecode | ~11.5 KB (all the logic) | 45 bytes (a pointer) |
| Holds funds / state? | **No** — `seats() = 0`, `initialized = true` (locked) | **Yes** — pot, bonds, members |
| Direct transactions | none — it only ever appears under **Internal Transactions** | all user actions land here |

Two clones share identical code yet stay fully independent — verifiable right now:
`seats/mode` reads `3 / 1` (AUCTION) on [`0xc279…81E2e`](https://testnet.monadexplorer.com/address/0xc27967918b15232f95b3bac464ed43a36c181e2e)
vs `3 / 0` (LUCKY_DRAW) on [`0xc2c9…B93c`](https://testnet.monadexplorer.com/address/0xc2c970a2af9b06844221b02976a78360fdffb93c).

**Why the explorer looks "empty" for the implementation and the registry**

Explorers default to a *Transactions* tab filtered on `to == address`. Neither contract is
ever a tx's `to` — both are reached only as **internal calls**. Their activity is real, just
on a different tab:

- Implementation → [**Internal Transactions**](https://testnet.monadvision.com/address/0xbffecAADE520A17a6728aC8cDc2A1e7F60266A74?tab=Internal+Transaction) — one delegatecall per user action, across every circle.
- Registry → **Events/Logs**. Proof: the AUCTION circle's completion tx
  [`0xffea4006…`](https://testnet.monadexplorer.com/tx/0xffea400620a454283197fb8c140d5f8be850dbf7f7487fb32f6f3f1b9383766f)
  (block 46342285) carries **3 `Attested` logs emitted by the registry**, one per member.
  Call chain: `Pyth keeper → Entropy → Circle clone → Registry.attest() ×3`.

```
you ──tx──> CircleFactory              (create, once)
you ──tx──> Circle clone ──delegatecall──> Circle impl      (join/commit/reveal/claim)
Pyth keeper ──tx──> Entropy ──call──> Circle clone ──call──> ReputationRegistry.attest()
```

### Verifiable randomness — proven on-chain

Every draw is settled by **Pyth Entropy's keeper**, not by us: the circle emits a
request, Pyth's off-chain nodes fetch a [drand](https://drand.love) random number and
call back. The circle **sponsors the fee from its own balance** (~0.126–0.38 MON per
draw depending on seat count), so members never spend native tokens. Both modes were
run end-to-end against the **current** contracts above, with every draw fulfilled by
Pyth's real keeper (script: [`scripts/lifecycle-run.ts`](scripts/lifecycle-run.ts)):

| Mode | Round | requestDraw | Pyth fulfilment (WinnerDrawn) |
|------|-------|-------------|-------------------------------|
| **Auction** | 1 | [`0x511b1fb5…`](https://testnet.monadexplorer.com/tx/0x511b1fb5c137fe99d7fd32131f824ce57eb25c80c7e466e81fb3c1b9f6f9ca9e) | [`0x27a59d0b…`](https://testnet.monadexplorer.com/tx/0x27a59d0b1a739e6aff95d68d457b709ea14ce1e087d58ecf12e0c3e2021e90c6) |
| **Auction** | 2 | [`0xf976ae2a…`](https://testnet.monadexplorer.com/tx/0xf976ae2aa6e878cd391cdb430451d7030dea07c261106e34bc3f4ffb8bad1b38) | [`0x82c5acc2…`](https://testnet.monadexplorer.com/tx/0x82c5acc21549f11a137f3811271d4b38a93054cff18eac2d94c0b58bb93f8de8) |
| **Auction** | 3 | [`0xf47d52e9…`](https://testnet.monadexplorer.com/tx/0xf47d52e97e103172369442bba17038b2f3f651c4c3648b7511c228c6ad812b4c) | [`0xffea4006…`](https://testnet.monadexplorer.com/tx/0xffea400620a454283197fb8c140d5f8be850dbf7f7487fb32f6f3f1b9383766f) |
| **Lucky draw** | 1 | [`0xdaf037a4…`](https://testnet.monadexplorer.com/tx/0xdaf037a4a7cd3cd4e420b5bdc93150f75a485cedc9e0495c87ab4c017e4d8fec) | [`0xe86a70ab…`](https://testnet.monadexplorer.com/tx/0xe86a70ab5f4e704b2f979c39c11d1055e2057add11ac2c5e8ce456a11f7bed1e) |
| **Lucky draw** | 2 | [`0x6c140143…`](https://testnet.monadexplorer.com/tx/0x6c140143e4f33a9cc86229ddb3a805e467e0f6b18451e6fc3646cef5ed13e2ce) | [`0x1b2cb710…`](https://testnet.monadexplorer.com/tx/0x1b2cb710ed20e3266af75708e0cb9a5f436551df87badb887a0e9b81cde97eff) |
| **Lucky draw** | 3 | [`0xae3af88e…`](https://testnet.monadexplorer.com/tx/0xae3af88e7d6b844aadc78529adaa05a638be2f4a0d14a48a632d28656e0d7036) | [`0xc9b2af13…`](https://testnet.monadexplorer.com/tx/0xc9b2af133ccd1f5589fa0b47b12e733e522a3f77305f872ebf78cae86bcd67e8) |

In every fulfilment tx the **sender is Pyth's keeper address**
([`0xeea5b6c1…`](https://testnet.monadexplorer.com/address/0xeea5b6c1CEA39c8024F13D2C055baDB030256bF4)),
not the deployer, and the `to` is Pyth's own Entropy contract — the randomness is
genuinely external. This is "trust the math, not the person" made literal: no human,
including the organizer, chooses the winner.

## A Real Auction Circle, Start to Finish (live on current contracts)

Circle [`0xc27967918b15232f95b3bac464ed43a36c181e2e`](https://testnet.monadexplorer.com/address/0xc27967918b15232f95b3bac464ed43a36c181e2e) —
3 members, 3 monthly rounds, everyone wins exactly once, run end-to-end against the
**current Design A contracts**. Click any hash to verify it yourself. Full machine-readable
log: [`scripts/out/lifecycle-auction-1784486929124.json`](scripts/out/lifecycle-auction-1784486929124.json).

**The setup:** 3 members each put in a **20 mUSDC safety bond** + pay **10 mUSDC/round**.
Each round, the pot is 30 mUSDC. Members secretly bid a *discount* — "I'll take less
so I can have the money now." Highest bidder wins the pot minus their discount, and the
discount they gave up is **split back to everyone as a dividend**. Once you win, you're
out of future bidding — but under Design A you **keep paying your full contribution**
every round, same as everyone else, so the pot never shrinks. Just like a real Indian
chit fund.

| # | Step | In plain English | Transaction |
|---|------|------------------|-------------|
| 1 | Create circle | A new auction circle is born (3 seats), VRF pre-funded for all 3 draws | [`0x2e20cc70…`](https://testnet.monadexplorer.com/tx/0x2e20cc70eec8398748f246ca043fa20978791195f6cac8320bae09a96f1ebf86) |
| 2 | Join ×3 | Each member stakes their bond and takes a seat | [`0x695af0c5…`](https://testnet.monadexplorer.com/tx/0x695af0c57089321ed915399e122ef5d5e8cc5e5d6e6884ae1dcff2017336fa79) · [`0x3851e769…`](https://testnet.monadexplorer.com/tx/0x3851e769c49da6b054dba9601ee4c8a73cc0e90390fb2e391d283fc5997017be) · [`0x786fd6e3…`](https://testnet.monadexplorer.com/tx/0x786fd6e36f06f03b448994031b178b7f0fe9e0094c3c810ccf388d206066d84d) |

**Round 1** — everyone pays in, then secretly bids:

| # | Step | In plain English | Transaction |
|---|------|------------------|-------------|
| 3 | Commit ×3 | Each member locks in a *sealed* bid (nobody can see it yet) | [`0x02ea5f87…`](https://testnet.monadexplorer.com/tx/0x02ea5f87cbde0f38b2f4abb7c3f56287c0700be65dc09ccf895a4fcd9d152336) · [`0xa3c69122…`](https://testnet.monadexplorer.com/tx/0xa3c691228c12ccc51f421b870792566f7960dc01599a065c89111832b4e5aa34) · [`0x5fa37c87…`](https://testnet.monadexplorer.com/tx/0x5fa37c87c57aeb5ad357079644f283dda6b91dbedbe9c878aae2f866f2739db5) |
| 4 | Open bidding | Sealed phase ends; reveals can begin | [`0x1a3b417b…`](https://testnet.monadexplorer.com/tx/0x1a3b417ba390f79db5046f850090023d37d2febaa87d98eec72cf8045383bf03) |
| 5 | Reveal ×3 | Each member unseals their bid on-chain (1, 2, 3 mUSDC) | [`0xac2e591a…`](https://testnet.monadexplorer.com/tx/0xac2e591a2923239c5822b32e25d3f7827cac29fe5d9e308a88ada9816659d16a) · [`0x0ea154e8…`](https://testnet.monadexplorer.com/tx/0x0ea154e817886aa0a1f23e5507481709d2e576ff3bb4e687d63420138e02e4cc) · [`0xf415e52b…`](https://testnet.monadexplorer.com/tx/0xf415e52bd13a05dcafbe82ec31e704ce1400f68d0b14ec5fcc4bfcf66c6fbfca) |
| 6 | Request + settle draw | Highest bidder wins the **full 30 mUSDC pot** minus their discount; discount split as dividend | [`0x511b1fb5…`](https://testnet.monadexplorer.com/tx/0x511b1fb5c137fe99d7fd32131f824ce57eb25c80c7e466e81fb3c1b9f6f9ca9e) → [`0x27a59d0b…`](https://testnet.monadexplorer.com/tx/0x27a59d0b1a739e6aff95d68d457b709ea14ce1e087d58ecf12e0c3e2021e90c6) |

**Round 2** — the round-1 winner is excluded from bidding but keeps paying the FULL
10 mUSDC contribution (Design A: this is the fix — the pot stays 30 mUSDC, not 20):

| # | Step | In plain English | Transaction |
|---|------|------------------|-------------|
| 7 | Commit ×3 | All three commit — the past winner commits too, to pay | [`0xc91c2bbe…`](https://testnet.monadexplorer.com/tx/0xc91c2bbe22816522bd527fc3d25bfca33530dbdcc1f44dfb8308da5cb14133a5) · [`0xc9019d33…`](https://testnet.monadexplorer.com/tx/0xc9019d3366ddbab32d21cb69a092aeb55f131d69d489753f929906bf02a81579) · [`0x8a073d69…`](https://testnet.monadexplorer.com/tx/0x8a073d69b6f21291c902200fb309708c7a0311d578c6a3760d68f1f897899ba3) |
| 8 | Open + reveal ×2 | The two eligible bidders reveal (the past winner is auto-revealed at their commit, bid forced to 0 — they can't bid again) | [`0x5b5aa4ee…`](https://testnet.monadexplorer.com/tx/0x5b5aa4eeb5796a08745f339f8bf79f84f51de2b8846c055773e7f5a6ea726f7a) · [`0x1527b37b…`](https://testnet.monadexplorer.com/tx/0x1527b37bc213956d53bfa5d95a6b57d35d09cc9061a8104d6df45a59f8d40992) · [`0xb45c17e9…`](https://testnet.monadexplorer.com/tx/0xb45c17e91f6b55fceb6f68368af3a42fdce4e592a6b6c0695cdb04c40932ad90) |
| 9 | Request + settle draw | Higher of the two remaining wins; dividend split again | [`0xf976ae2a…`](https://testnet.monadexplorer.com/tx/0xf976ae2aa6e878cd391cdb430451d7030dea07c261106e34bc3f4ffb8bad1b38) → [`0x82c5acc2…`](https://testnet.monadexplorer.com/tx/0x82c5acc21549f11a137f3811271d4b38a93054cff18eac2d94c0b58bb93f8de8) |

**Round 3 (final)** — two past winners now pay-but-can't-bid; only one member left
eligible, so they win automatically and the circle closes:

| # | Step | In plain English | Transaction |
|---|------|------------------|-------------|
| 10 | Commit ×3 + reveal ×1 | All three commit (both past winners pay); the last eligible member reveals | [`0x619af70e…`](https://testnet.monadexplorer.com/tx/0x619af70ed54beb81c89435f50a691f0bbfad21c9bb7e96dc4b1d4ef8b27ebac1) · [`0x0a01a46f…`](https://testnet.monadexplorer.com/tx/0x0a01a46f4a6610abc52a984edf0b431fa25784b9555099ffb7a9fc07156c5b0f) · [`0xbcbc77b0…`](https://testnet.monadexplorer.com/tx/0xbcbc77b06782c13e8f835db71654191c07bfed12beacc776546f52fe005a8455) · [`0x0a835ff1…`](https://testnet.monadexplorer.com/tx/0x0a835ff1e8639e84e5637b67eb81aab189f190ac2e4f0ca1b943c35af5a97781) |
| 11 | Request + settle + **complete** | Last member wins, bonds returned, circle **COMPLETED** | [`0xf47d52e9…`](https://testnet.monadexplorer.com/tx/0xf47d52e97e103172369442bba17038b2f3f651c4c3648b7511c228c6ad812b4c) → [`0xffea4006…`](https://testnet.monadexplorer.com/tx/0xffea400620a454283197fb8c140d5f8be850dbf7f7487fb32f6f3f1b9383766f) |

**The result:** all 3 members won exactly once, every bond came back, and after
**every single round** the contract's balance exactly equalled *what it owes members +
dividends + bonds* — verified on-chain after every round
(`balance == claimable + dust + undrawnPools + bonds`, checked automatically by
[`scripts/lifecycle-run.ts`](scripts/lifecycle-run.ts)):

| After round | Contract balance | claim + dust + undrawn + bonds | Pot this round |
|---|---|---|---|
| 1 | 90,000,000 (90 mUSDC) | 90,000,000 | 30 mUSDC — full pool ✓ |
| 2 | 120,000,000 (120 mUSDC) | 120,000,000 | 30 mUSDC — full pool ✓ (Design A: NOT 20) |
| 3 | 150,000,000 (150 mUSDC) | 150,000,000 | 30 mUSDC — full pool ✓ |

No money created, none lost, no organizer fee, and the pot never shrank even with two
past winners still in the circle. **Trust the math, not the person.**

## The Other Mode: A Lucky-Draw Circle, Start to Finish (live on current contracts)

Circle [`0xc2c970a2af9b06844221b02976a78360fdffb93c`](https://testnet.monadexplorer.com/address/0xc2c970a2af9b06844221b02976a78360fdffb93c) —
lucky-draw mode, where the winner each round is picked at **random** instead of by
bidding: 3 people, 3 rounds, everyone wins once. Full machine-readable log:
[`scripts/out/lifecycle-lucky_draw-1784486782547.json`](scripts/out/lifecycle-lucky_draw-1784486782547.json).

**How it differs from the auction:** there's no bidding and no dividend. Every round each
member simply pays their **10 mUSDC** into the pot, and one member is drawn **at random** to
take the **whole 30 mUSDC pot**. Just like a real rotating savings group ("chit"/"committee"),
**past winners keep paying in and keep manually revealing every round** — they're excluded
only from being **drawn** again, not from the commit/reveal flow itself (LUCKY_DRAW has no
bidding to auto-exclude them from, unlike AUCTION mode — see
[docs/LEGACY_README_NOTES.md](docs/LEGACY_README_NOTES.md#4-a-subtlety-worth-keeping-in-mind-lucky_draw-vs-auction-past-winner-behavior)
for why this distinction matters).

**Setup:**

| # | Step | In plain English | Transaction |
|---|------|------------------|-------------|
| 1 | Create circle | A new lucky-draw circle is born (3 seats) | [`0x04f1eb71…`](https://testnet.monadexplorer.com/tx/0x04f1eb71c07be5dfbf3db9f8a46cfc4b5eaa483c3e9739abb3f89a417a2efc97) |
| 2 | Join ×3 | Each member stakes their 20 mUSDC bond and takes a seat | [`0x6ffa49e4…`](https://testnet.monadexplorer.com/tx/0x6ffa49e45ca2278bc16e85401b7c78b1e0ac62d94b97b42a49cee286c7b410a1) · [`0x562353db…`](https://testnet.monadexplorer.com/tx/0x562353db41336749df590fa57d5348743f6adb5135d1bdc28c8e37ca24d716b9) · [`0xbf60f97d…`](https://testnet.monadexplorer.com/tx/0xbf60f97dc1c0cfa030d1b67ff287fdcf251996990ec7a35da43628a255ea2f55) |

**Round 1** — everyone pays in, then a random winner is drawn:

| # | Step | In plain English | Transaction |
|---|------|------------------|-------------|
| 3 | Commit ×3 | Each member pays their 10 mUSDC into the pot | [`0xc84eda4c…`](https://testnet.monadexplorer.com/tx/0xc84eda4c0c09c47b7a7658f1aa5a4af2cd35fbd86495aec859ab1d1f30d6bdda) · [`0x8dffdb5a…`](https://testnet.monadexplorer.com/tx/0x8dffdb5a4da1b2d7409b56a8c899a00998d1282b0ac55411ba946dc8194d63c3) · [`0x33d189ce…`](https://testnet.monadexplorer.com/tx/0x33d189ce4ff6f4b3d2a8a5cc4bc642fd23877ebf2a8a00594cf4055b2bd68faa) |
| 4 | Open + reveal ×3 | The round opens and everyone confirms their entry | [`0x53085f8f…`](https://testnet.monadexplorer.com/tx/0x53085f8f5cfd9c730ac30528ac63dae855340796d1e4a8b9b63bcf7fe21a5188) · [`0xc2fc693b…`](https://testnet.monadexplorer.com/tx/0xc2fc693bd4dbae758c90f35faee649a342b9654356b2be6b9e02ac176fb2df96) · [`0x14890244…`](https://testnet.monadexplorer.com/tx/0x14890244ea4f9082cfa8160342630b5d77a8f321e26b5151838ff36b1c32f6f8) · [`0x558dfc7f…`](https://testnet.monadexplorer.com/tx/0x558dfc7fce895f4bb4f61820d5208e6b6fd319fddaca965f7dd15e85347a0358) |
| 5 | Request + settle draw | Randomness picks the winner; **full 30 mUSDC pot** is theirs | [`0xdaf037a4…`](https://testnet.monadexplorer.com/tx/0xdaf037a4a7cd3cd4e420b5bdc93150f75a485cedc9e0495c87ab4c017e4d8fec) → [`0xe86a70ab…`](https://testnet.monadexplorer.com/tx/0xe86a70ab5f4e704b2f979c39c11d1055e2057add11ac2c5e8ce456a11f7bed1e) |

**Round 2** — the round-1 winner keeps paying in AND keeps revealing, but can't be
drawn again:

| # | Step | In plain English | Transaction |
|---|------|------------------|-------------|
| 6 | Commit ×3 | All three pay in again (winner included, full 10 mUSDC each) | [`0x5a9403e7…`](https://testnet.monadexplorer.com/tx/0x5a9403e780dbcb41917829e5d3f332f1f9df1bf44fb8084ef9cbe88cbdefad54) · [`0x2c840124…`](https://testnet.monadexplorer.com/tx/0x2c840124275275561cfa67ca7a49f058af836174eee7a5fc566468b17979d287) · [`0x7873cf49…`](https://testnet.monadexplorer.com/tx/0x7873cf4930e4694059ed0efc4d21bf5b4216b7a88ff3472d7ba73be8f8609b51) |
| 7 | Open + reveal | The two remaining eligible members reveal (the past winner needed a manual reveal here too — LUCKY_DRAW has no auto-reveal-on-commit) | [`0x75bfaf6d…`](https://testnet.monadexplorer.com/tx/0x75bfaf6d63dc91c0edb8c9caf42a39636c74ce8b1af2fc92f1a85a2398677861) · [`0xdaccd41a…`](https://testnet.monadexplorer.com/tx/0xdaccd41a3a419ea80d7dd50945f70e195ac79dfdb5b83711b9eb76b43e12ba27) · [`0xe2d45ddf…`](https://testnet.monadexplorer.com/tx/0xe2d45ddf81bf34a4bf1b64409ca073aa40b62c00f95dfca7964760b45349f572) |
| 8 | Request + settle draw | One of the two remaining is drawn; takes the pot | [`0x6c140143…`](https://testnet.monadexplorer.com/tx/0x6c140143e4f33a9cc86229ddb3a805e467e0f6b18451e6fc3646cef5ed13e2ce) → [`0x1b2cb710…`](https://testnet.monadexplorer.com/tx/0x1b2cb710ed20e3266af75708e0cb9a5f436551df87badb887a0e9b81cde97eff) |

**Round 3 (final)** — only one member hasn't won, so they win and the circle closes:

| # | Step | In plain English | Transaction |
|---|------|------------------|-------------|
| 9 | Commit + reveal ×3 | Final round paid in and confirmed by all three | [`0x483deca8…`](https://testnet.monadexplorer.com/tx/0x483deca8a152f2c0ff73679087d0dcb7881dc10189de565fabae0c08bb0945ab) · [`0x67c9c533…`](https://testnet.monadexplorer.com/tx/0x67c9c533f7047510b56fb931d5345da24850f840521195d459d4591e87c12b48) · [`0x73622cac…`](https://testnet.monadexplorer.com/tx/0x73622cac87791d8908e072b3b828b6864cead4addb64fae47d7de0a8afdd5e44) → [`0xc9c5c006…`](https://testnet.monadexplorer.com/tx/0xc9c5c0063e0803c58a2480e929a82a4a7bd08125243e9f2d73bc2e3743014f48) · [`0xf65f2df4…`](https://testnet.monadexplorer.com/tx/0xf65f2df46b5494815e1808500f1668693605b9e172db797f8e3cfe938432d4d7) · [`0x50a72bd2…`](https://testnet.monadexplorer.com/tx/0x50a72bd2c5671a49716a7739ca79230612a55262e1b5edfb28740de43d300222) |
| 10 | Request + settle + **complete** | Last member wins, bonds returned, circle **COMPLETED** | [`0xae3af88e…`](https://testnet.monadexplorer.com/tx/0xae3af88e7d6b844aadc78529adaa05a638be2f4a0d14a48a632d28656e0d7036) → [`0xc9b2af13…`](https://testnet.monadexplorer.com/tx/0xc9b2af133ccd1f5589fa0b47b12e733e522a3f77305f872ebf78cae86bcd67e8) |

**The result:** all 3 members won exactly once, the circle reached **COMPLETED**, and
the conservation check held after every round:

| After round | Contract balance | claim + dust + undrawn + bonds |
|---|---|---|
| 1 | 90,000,000 (90 mUSDC) | 90,000,000 |
| 2 | 120,000,000 (120 mUSDC) | 120,000,000 |
| 3 | 150,000,000 (150 mUSDC) | 150,000,000 |

Same guarantees as the auction — just a random winner instead of a bid-based one, and
no dividend mechanic (the whole pot goes to the drawn winner).

## Architecture — resilient by design

**One principle runs through every layer: the chain is the only source of truth;
everything else is a cache that can die and be rebuilt.** No off-chain component
can lose your money or block a round — the worst any outage does is make the UI a
few seconds slower. Here's each segment and the exact job it does for the build:

```
                         ┌─────────────────────────────────────────────┐
   Browser (Next.js)     │  Monad testnet — SOURCE OF TRUTH            │
   ├─ Privy login  ──────┼─► CircleFactory ─► Circle clones (escrow)   │
   ├─ reads chain direct │      │                    │                 │
   │  (never blocked) ◄──┼──────┘        Pyth Entropy ─► draw callback │
   └─ writes txs ────────┼─► Circle clone ─► ReputationRegistry        │
                         └───────▲──────────────────────┬──────────────┘
                                 │ getLogs (replayable)  │ events
              ┌──────────────────┴───────┐              │
   NestJS API │  Postgres (rebuildable cache) ◄─────────┤ Indexer worker
   ├─ serves indexed reads (fast)        │              ├ VRF keeper (draws)
   ├─ chain-read FALLBACK when cache lags │             └ Notify worker ─► Redis/BullMQ
   └─ invites · profiles · sponsorship   │                                  └► email/WhatsApp/push
```

| Segment | What it is | How it helps the build |
|---|---|---|
| **`packages/contracts`** | Foundry — `Circle.sol`, `CircleFactory.sol`, `ReputationRegistry.sol` | **The moat.** All money logic + custody live here; nothing else can move funds. One implementation, cloned per circle (45-byte proxies) for cheap isolated escrow. 78 tests + 2 invariant suites (128k calls each). |
| **`packages/shared`** | Generated ABIs + deployed addresses (`@bhishi/shared`) | **Single wiring point.** ABIs are generated from the compiled contract, so web/api/workers can never drift from what's actually deployed — one `sync` after a deploy propagates everywhere. |
| **`packages/events`** | Chunked RPC log reader (`@bhishi/events`) | **Replay engine.** Reads `getLogs` in ≤100-block windows (Monad's cap). Because every chain event is replayable, the entire Postgres cache can be rebuilt from block zero — the DB is disposable. |
| **`packages/db`** | Prisma schema — indexed **mirror** of chain state | **Speed, not truth.** Serves circle lists/history in ~40ms instead of 3+ sequential RPC round-trips. Explicitly a cache: wipe it and the indexer reconstructs it. |
| **`apps/web`** | Next.js · Privy embedded wallets · gas sponsorship | **Zero-crypto onboarding.** Email/Google login mints a wallet; a paymaster sponsors gas so members never touch native tokens. Critically, it **reads the chain directly for anything it acts on** — so a lagging or down indexer never blocks a join/commit/reveal. |
| **`apps/api`** | NestJS — indexed reads, invites, profiles, sponsorship | **Fast path with a chain fallback.** Serves cached reads, but when the cache lags (e.g. a brand-new circle) it reads the missing fact **straight from the contract** (creator, mode, config) — so features work the instant a tx mines, not when the indexer catches up. |
| **`apps/workers`** | 3 independent processes | **Off-chain automation, none load-bearing.** **Indexer**: chain → Postgres, resumes from a persisted cursor. **VRF keeper**: nudges permissionless `requestDraw()`/`advanceToReveal()` so rounds never stall waiting on a human. **Notify**: round-deadline reminders via Redis/BullMQ → email/WhatsApp/web-push. Kill any of them and the protocol still runs — members just self-drive via the UI. |
| **`scripts/lifecycle-run.ts`** | Full on-chain lifecycle runner | **Living proof.** Drives a complete 3-round circle (both modes) against the live contracts, Pyth-fulfilled, asserting the conservation invariant every round — the transactions in this README came from it. |

**Why this shape matters:** the four failure modes I hit building this — indexer
behind, RPC rate-limited, DB migration missing, a draw never triggered — each
degraded *one* cache or worker, and in every case the chain-direct reads and
permissionless recovery paths meant **no circle ever lost funds or got
permanently stuck.** That's the resilience: off-chain is convenience, on-chain is
truth.

Deeper docs: [architecture-spec](docs/architecture-spec.md) ·
[threat model](docs/THREAT-MODEL.md) ·
[Design A fix](DESIGN_A_PLAN.md) ·
[bond sizing](docs/BOND_SIZING_RESEARCH.md) ·
[legacy notes](docs/LEGACY_README_NOTES.md)

## Quick Start

```bash
# Install
pnpm install

# Run contract tests (78 passing, including two invariant suites with 128k handler calls each)
cd packages/contracts && forge test

# Run a full live lifecycle against the deployed contracts (both modes)
cp packages/contracts/.env.example packages/contracts/.env
# Fill PRIVATE_KEY and MONAD_RPC_URL in .env, then:
source packages/contracts/.env
MODE=auction npx tsx scripts/lifecycle-run.ts
MODE=lucky_draw npx tsx scripts/lifecycle-run.ts

# Start frontend
cp apps/web/.env.example apps/web/.env.local
# Fill NEXT_PUBLIC_PRIVY_APP_ID, then:
pnpm --filter web dev

# Start the API + indexer (needs Postgres + Redis)
pnpm --filter @bhishi/db migrate
pnpm --filter @bhishi/api dev
pnpm --filter @bhishi/workers dev:indexer
```

## Deploy

The factory/registry pair must be redeployed together — `ReputationRegistry.factory`
is immutable, so a new factory always needs a new registry. `MockStable` should be
**reused** across redeploys unless there's a reason to reset test balances (a new
MockStable orphans everyone's existing mUSDC).

```bash
cd packages/contracts

# Full fresh stack (new MockStable + everything) — first deploy only:
forge script script/Deploy.s.sol --rpc-url monad_testnet --broadcast --verify

# Redeploy Circle+Factory+Registry only, REUSING an existing MockStable
# (this is what shipped the Design A fix):
STABLE=0x... PYTH_ENTROPY=0x825c0390f379C631f3Cf11A82a37D20BddF93c07 \
  forge script script/DeployDesignA.s.sol:DeployDesignA --rpc-url monad_testnet --broadcast

# Then:
# 1. Update packages/shared/src/addresses.ts with the new addresses, `cd packages/shared && npm run build`
# 2. Update apps/workers/.env: FACTORY_ADDRESS + START_BLOCK (the factory's deploy block)
# 3. Reset the indexer's cursor if resuming an existing DB: UPDATE "IndexerCursor" SET "lastIndexedBlock" = <START_BLOCK> WHERE id = 'factory';
# 4. Restart web/api/workers so they pick up the rebuilt @bhishi/shared package
forge script script/SeedDemo.s.sol --rpc-url monad_testnet --broadcast
```

## Installs as an app (PWA)

Bhishi is a full Progressive Web App, so a ROSCA — a fundamentally *mobile*,
recurring, deadline-driven habit — lives on the home screen instead of a bookmark.

- **Installable** — `manifest.webmanifest` (`display: standalone`, maskable icons,
  portrait, screenshots) → "Add to Home Screen" on Android/iOS, a real window on
  desktop. Launches to `/dashboard`, no browser chrome.
- **Works offline** — a hand-written service worker ([`sw.js`](apps/web/public/sw.js))
  pre-caches the app shell and serves navigations **network-first, then cache,
  then an `/offline` page**. It deliberately **never intercepts RPC or API calls**
  (cross-origin / non-navigation requests pass straight through) — so a stale
  cache can never feed you wrong chain data.
- **Push reminders** — a ROSCA fails on missed deadlines, so Web Push (VAPID)
  delivers commit/reveal-window reminders to the device even when the app is
  closed. One subscription row per device; the notify worker fans out to
  web-push, email, and WhatsApp.
- **Device-aware UX** — responsive layout, safe-area insets, theme-color for the
  OS status bar, and gasless smart-account transactions so a phone user with zero
  native tokens can still join and pay.

## Security — what I hardened, and where

Custody of real value means the threat model came first, not last. Layer by layer:

**Contract (the money layer)**
- **No custody escape hatch** — there is no `withdraw`, `owner`, `admin`, or
  upgrade path. Even the deployer cannot touch a circle's funds (proven: CUSTODY).
- **Reentrancy** — every fund-moving function is `nonReentrant` and follows
  strict **checks-effects-interactions** (state written before any external
  transfer); a dedicated `ReentrancyHarness` test attacks the path.
- **Safe token handling** — `SafeERC20` throughout; a reverted transfer can't be
  silently treated as success.
- **Clone hijack prevention** — the implementation is `initialized`-locked so no
  one can initialize it as a rogue circle; each clone has isolated storage.
- **Randomness integrity** — draw callbacks are accepted **only** from the real
  Pyth Entropy address; no human, including us, can influence a winner.
- **Registry gating** — only factory-deployed circles in `COMPLETED` state can
  write reputation, each `(circle, member)` once — fake circles revert
  `NotFactoryCircle` (proven on-chain above).
- **Liveness / anti-griefing** — permissionless `slash()`, `advanceToReveal()`,
  `requestDraw()`, `reclaimOnStall()` mean no single actor can freeze a round or
  strand funds; bond sizing is proven to make post-win default unprofitable.

**App / API layer**
- **Server-verified identity** — every protected route verifies the Privy access
  token server-side (`PrivyAuthGuard`); the acting wallet is read from the
  verified session, **never** trusted from the request body.
- **Rate limiting** — `@nestjs/throttler` on mutating endpoints (invites, etc.).
- **Sponsorship is bounded** — the relayer only ever tops up the *caller's own*
  verified smart account, with a per-user daily cap (anti-drain).
- **No trust in the cache** — anything security-relevant (creator checks, balances,
  phase) is re-read from chain, so a poisoned or lagging DB can't authorize an action.
- **Secrets never leave the device** — commit-reveal salts are client-side only;
  the chain stores just the hash.

## Tests — 78 across 16 suites, `forge test` green

Not a happy-path demo — the suite is built around the failure modes that lose money.

| Kind | Count | What it covers |
|---|---|---|
| **Invariant** (stateful fuzz) | **2 suites — 128k calls each** | Conservation (`balance == claimable + dust + undrawn + bonds`) holds across 256 randomized runs × 128,000 state transitions, in **both** modes |
| **Fuzz** | 1 | Post-win default is unprofitable for *any* bond/round combination (256 runs) |
| **Unit + integration** | ~75 | one suite per risk surface (below) |

Each suite targets a specific way money could go wrong:

`Custody` (no withdraw) · `Fairness` (only Pyth sets the winner) · `Slashing` +
`SlashFSM` (default → bond slashed, round auto-advances) · `WinnerDefault`
(default-after-win unprofitable) · `ReclaimOnStall` (VRF-silence recovery) ·
`ReentrancyHarness` (attack the transfer path) · `FakeCircleAttest`
(fake circle can't mint reputation) · `CommitReveal` / `Auction` (sealed-bid +
the Design-A shrinking-pot regression) · `Filling` / `FillingTimeout` (join +
abort-refund) · `VrfSponsorship` (circle self-funds draws) ·
`CircleFactory` / `ConservationInv` / `MockStable`.

```bash
cd packages/contracts && forge test        # 78 passing
```

## Tech Stack

Solidity 0.8.30 · Foundry · OpenZeppelin v5 · Pyth Entropy · Monad testnet
Next.js · Privy embedded wallets · wagmi/viem · Tailwind CSS · NestJS · Prisma · pnpm · Turborepo
