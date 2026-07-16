# Bhishi — Non-Custodial Savings Circle on Monad

> *"Trust the math, not the person."*

[![Monad Testnet](https://img.shields.io/badge/Monad-Testnet-7C3AED)](https://testnet.monadexplorer.com)

Bhishi removes the two dangers of every savings circle (ROSCA):
1. **The organizer holds your money** → Bhishi uses non-custodial escrow
2. **The organizer picks who gets paid** → Bhishi uses Gelato VRF (verifiable randomness)

And the third danger nobody designs for:
3. **The machinery itself strands your funds** → Bhishi has permissionless reclaim paths

## Four Provable Money Shots

| Proof | What it shows |
|-------|--------------|
| ✓ **CUSTODY** | `organizer.withdraw()` reverts — the contract has no such function |
| ✓ **FAIRNESS** | Winner is selected by Gelato VRF, not by any human |
| ✓ **DEFAULT** | Missed reveal → bond auto-slashes, winner still made whole |
| ✓ **LIVENESS** | VRF silence → any member calls `reclaimOnStall()`, funds recovered |

```bash
pnpm demo   # proves all four shots live on Monad testnet
```

## Deployed Contracts (Monad Testnet)

Live on Monad testnet (chain `10143`). Click any address to open it in the explorer.

| Contract | What it does | Address |
|----------|--------------|---------|
| **CircleFactory** | Creates new savings circles (one-click clones) | [`0x8D5EB1518fF5530f7a259582f6aFDfd530B3807C`](https://testnet.monadexplorer.com/address/0x8D5EB1518fF5530f7a259582f6aFDfd530B3807C) |
| **Circle** (implementation) | The circle logic all clones share | [`0xBaB7832e1b507c041c2c1cc6aE9D638320950114`](https://testnet.monadexplorer.com/address/0xBaB7832e1b507c041c2c1cc6aE9D638320950114) |
| **ReputationRegistry** | Records who paid on time / who defaulted | [`0x4d3d21137cF1aAa678d9e613b35409b342DE491A`](https://testnet.monadexplorer.com/address/0x4d3d21137cF1aAa678d9e613b35409b342DE491A) |
| **MockStable** (mUSDC) | Test stablecoin with a free faucet | [`0xb6600b753BDFaD238cd4e6Ca652b520F2F1fC38c`](https://testnet.monadexplorer.com/address/0xb6600b753BDFaD238cd4e6Ca652b520F2F1fC38c) |

## A Real Auction Circle, Start to Finish (live on-chain)

We ran one complete **auction-mode** circle end-to-end on Monad testnet — 3 people,
3 monthly rounds, everyone wins exactly once. Here's what happened, in plain English,
with the actual transaction for each step. Click any hash to verify it yourself.

**The setup:** 3 members each put in a **20 mUSDC safety bond** + pay **10 mUSDC/round**.
Each round, the pot is 30 mUSDC. Members secretly bid a *discount* — "I'll take less
so I can have the money now." Highest bidder wins the pot minus their discount, and the
discount they gave up is **split back to everyone as a dividend**. Once you win, you're
out of future bidding but keep paying in — just like a real Indian chit fund.

| # | Step | In plain English | Transaction |
|---|------|------------------|-------------|
| 1 | Create circle | A new auction circle is born (3 seats) | [`0x059b5e29…`](https://testnet.monadexplorer.com/tx/0x059b5e2912fae4ad4093ae3daf45e7d81bcafd21594c96819acbc018fb350387) |
| 2 | Join ×3 | Each member stakes their bond and takes a seat | [`0x0e25cd61…`](https://testnet.monadexplorer.com/tx/0x0e25cd618419667605c904921be384114a050f3a5f80a7991e04ae0970acbc9e) · [`0x87cb0c1d…`](https://testnet.monadexplorer.com/tx/0x87cb0c1dc51636fa6abdc6c77a869c9cf66616d40694e668b1224dab3dc519bd) · [`0x90b6187b…`](https://testnet.monadexplorer.com/tx/0x90b6187b6ab4076a3a9e7147aea599a63570ab21b6f2b5f843dd52810272b3a3) |

**Round 1** — everyone pays in, then secretly bids:

| # | Step | In plain English | Transaction |
|---|------|------------------|-------------|
| 3 | Commit ×3 | Each member locks in a *sealed* bid (nobody can see it yet) | [`0x3a65010c…`](https://testnet.monadexplorer.com/tx/0x3a65010ce1444d98ffe596a7fe5da8a586807b92d0e399a7461a5ab10d733d5c) · [`0x156dc4c7…`](https://testnet.monadexplorer.com/tx/0x156dc4c79c87a1dee1adc0b2fadb3bd715f724a27d3bf7555d4e23141d0d16d4) · [`0x4fd8d464…`](https://testnet.monadexplorer.com/tx/0x4fd8d464a5f62186b3aa405184945a9788f5e7f4a3e4b27fe2ed08ace77b22db) |
| 4 | Open bidding | Sealed phase ends; reveals can begin | [`0xcf10cd57…`](https://testnet.monadexplorer.com/tx/0xcf10cd57661024bff6ab1489f819cb16da7589fda5016c8cbf8451317e47b098) |
| 5 | Reveal ×3 | Each member unseals their bid on-chain | [`0x77d285f5…`](https://testnet.monadexplorer.com/tx/0x77d285f5aa08099b0c6c0e6fcaf800ab90a0f103b2b0016de247271a64c21a8d) · [`0x64b493cc…`](https://testnet.monadexplorer.com/tx/0x64b493cc51257ceae0842ce0906b466c7dd9d718d490daa7d12ba492dc483a5c) · [`0x4d253b73…`](https://testnet.monadexplorer.com/tx/0x4d253b731de5c4441eb57fdaa55e56af8339d0c4edf524d4e1fc45f806d52a54) |
| 6 | Settle round | **Highest bidder wins**; discount paid out to all as dividend | [`0x1c92c74c…`](https://testnet.monadexplorer.com/tx/0x1c92c74cc7a1af81dae9a95deafad5a0735963a17d321753b5aa3a6700118197) |

**Round 2** — the round-1 winner is now excluded from bidding but keeps paying in:

| # | Step | In plain English | Transaction |
|---|------|------------------|-------------|
| 7 | Commit ×2 | The two remaining bidders seal their bids | [`0x786bd050…`](https://testnet.monadexplorer.com/tx/0x786bd0509fc953183805bc74b5e0746807870167b1d5e8634a046c5d215274a1) · [`0xca7a6e0c…`](https://testnet.monadexplorer.com/tx/0xca7a6e0c23e5dbb2b46f0d50514564ae4db68d75562312891b9696bfaa09bbd1) |
| 8 | Open + reveal ×2 | Bidding opens and both reveal | [`0x4b67dcb6…`](https://testnet.monadexplorer.com/tx/0x4b67dcb6a9f23499f33caf4a6e6ac7d549c46dc4b65bcfffe203f2a3f663e6e8) · [`0xc7ffc39f…`](https://testnet.monadexplorer.com/tx/0xc7ffc39f3b68d5c7557039665adaa715c12694b4964867614ece096af5004e3f) · [`0x18f24459…`](https://testnet.monadexplorer.com/tx/0x18f244593def59ca3ba0bd685067894d8f10720f5f3d9d71ecd52c88e3ee953c) |
| 9 | Settle round | Higher of the two wins; dividend split again | [`0xc9f63ee0…`](https://testnet.monadexplorer.com/tx/0xc9f63ee03e63aa87435436b20b79ccfd74d60b8fee18c1b544a463b96d3a67cb) |

**Round 3 (final)** — only one member left, so they win automatically and the circle closes:

| # | Step | In plain English | Transaction |
|---|------|------------------|-------------|
| 10 | Commit + reveal | The last member bids | [`0x9b579398…`](https://testnet.monadexplorer.com/tx/0x9b579398fc0054a164de89c6c167c232d79948645076216301163cec1500264e) · [`0x93947bea…`](https://testnet.monadexplorer.com/tx/0x93947bead8ba1acd6f7a3eb48bcbab21fc5c71445d1dee6882ff0d022ca6e650) |
| 11 | Settle + **complete** | Last member wins, bonds returned, circle **COMPLETED** | [`0x100bd40d…`](https://testnet.monadexplorer.com/tx/0x100bd40d1b4d117d2c151158a97d55bc2546d6e7dba8701b90a2e37ac08506d5) |

**The result** ([final circle `0x509b1505…`](https://testnet.monadexplorer.com/address/0x509b1505a382510cfcd5ae903332c2c728842f07)):
all 3 members won exactly once, every bond came back, and after **every single round**
the contract's balance exactly equalled *what it owes members + dividends + bonds* — no
money created, none lost, no organizer fee. **Trust the math, not the person.**

## Architecture

```
bhishi/
├── packages/contracts/   # Foundry — the moat (Circle.sol, CircleFactory.sol, ReputationRegistry.sol)
├── packages/shared/      # Generated ABIs + addresses (@bhishi/shared)
├── packages/events/      # RPC event reader (@bhishi/events)
├── apps/web/             # Next.js 14 + Privy embedded wallets + gas sponsorship
└── scripts/demo.ts       # Four money shots, live on Monad
```

Full architecture: [docs/architecture-spec.md](docs/architecture-spec.md)
Threat model: [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md)

## Quick Start

```bash
# Install
pnpm install

# Run tests (52 passing, including invariant suite with 128k handler calls)
cd packages/contracts && forge test

# Run demo against Monad testnet
cp packages/contracts/.env.example packages/contracts/.env
# Fill PRIVATE_KEY and MONAD_RPC_URL in .env, then:
pnpm demo

# Start frontend
cp apps/web/.env.example apps/web/.env.local
# Fill NEXT_PUBLIC_PRIVY_APP_ID, then:
pnpm --filter web dev
```

## Deploy

```bash
cd packages/contracts
forge script script/Deploy.s.sol --rpc-url monad_testnet --broadcast --verify
# Then update packages/shared/src/addresses.ts with deployed addresses
forge script script/SeedDemo.s.sol --rpc-url monad_testnet --broadcast
```

## Invariants Proven

- **Conservation**: `balance == totalClaimable + dustAccrued + roundPool + stakedBonds` — holds across 128,000 state transitions
- **Winner-default unprofitability**: defaulter after winning has net gain ≤ 0 (fuzz: 256 runs)
- **Fake circle can't mint reputation**: `NotFactoryCircle` revert enforced by registry

## Tech Stack

Solidity 0.8.30 · Foundry · OpenZeppelin v5 · Gelato VRF · Monad testnet
Next.js 14 · Privy embedded wallets · wagmi/viem · Tailwind CSS · pnpm · Turborepo
