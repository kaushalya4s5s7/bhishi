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

| Contract | Address |
|----------|---------|
| MockStable (mUSDC) | _fill after deploy_ |
| ReputationRegistry | _fill after deploy_ |
| CircleFactory | _fill after deploy_ |

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
