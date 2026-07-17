# Gasless UX Plan — members never hold MON

Goal: a member signs in with email and plays a circle without ever acquiring
native MON. Two separate costs must be covered; **one is already solved.**

| Cost | Who pays today | Status |
|---|---|---|
| **Pyth Entropy fee** (~0.126 MON per draw) | **the circle itself** | ✅ **Done** — the creator pre-funds all draws via `createCircle{value: vrfFundingFor(seats)}`; leftovers refund to them on completion. Members pay nothing. |
| **Gas for member txs** (`join`, `commit`, `reveal`, `claim`) | the member's embedded wallet | ❌ **Open** — this document |

## Why the second one isn't solved by the first

The VRF fee is paid *by a contract, from its own balance* — a contract can hold
MON. But `join()` is a **transaction sent by the member**, and on a plain EOA the
sender always pays gas. No contract-side trick fixes that; it needs **account
abstraction**: the member's tx is wrapped in a UserOperation and a **paymaster**
pays the gas.

## The verified path: Privy smart wallets + Pimlico paymaster

Both halves are confirmed to support Monad Testnet:

- **Pimlico** lists **Monad Testnet** among its supported chains (bundler +
  paymaster URL per chain from their dashboard).
- **Privy** supports **EVM smart wallets** and sponsors gas by **registering a
  paymaster URL in the Privy Dashboard** — requests are then routed through the
  paymaster instead of the user's wallet.
- **Monad maintains an official template** proving the exact combination:
  [`monad-developers/react-native-privy-pimlico-gas-sponsorship-template`](https://github.com/monad-developers/react-native-privy-pimlico-gas-sponsorship-template)
  (Privy embedded wallet + Pimlico paymaster on Monad Testnet, updated Dec 2025).
  It is React Native, but the wallet/paymaster wiring is the transferable part.

## What changes in Bhishi

Today `apps/web` uses Privy's **embedded EOA** directly:

```ts
// lib/wallet.ts — current
const provider = await embeddedWallet.getEthereumProvider();
createWalletClient({ account: userAddress, chain: monadTestnetChain, transport: custom(provider) });
```

The member's address IS the EOA, and it pays its own gas. To go gasless:

1. **Enable smart wallets in Privy** (Dashboard) and add the smart-wallet
   config/provider to `apps/web`. Each user gets a **smart account** whose owner
   is their existing embedded EOA.
2. **Create a Pimlico account**, get the **Monad Testnet** bundler/paymaster URL,
   and register the paymaster URL in the **Privy Dashboard** so Privy routes
   UserOperations through it.
3. **Send member txs from the smart account**, not the EOA — swap
   `getWalletClient()` for Privy's smart-wallet client. `join/commit/reveal/claim`
   call sites need no logic change beyond which client they use.
4. **Fund the Pimlico paymaster** with MON. This is the real cost centre: you are
   now paying every member's gas.

### The identity change that matters (do not miss this)

The member's on-chain address becomes the **smart account**, not the embedded
EOA. That address is what `join()` records as a member, what `commit()` hashes
into the commitment (`keccak256(amount, salt, msg.sender)`), and what `claim()`
pays. Anywhere the frontend uses `embeddedWallet.address` as the member identity
must switch to the smart-account address **consistently**, or commitments won't
verify and members won't match. This is the single highest-risk part of the
change and must be checked end-to-end on testnet.

## Status: code is DONE — it needs your dashboard keys to switch on

The app code is written and builds clean. It works **today** with plain EOAs
(members pay their own gas) and flips to fully-sponsored the moment you enable
smart wallets in the Privy Dashboard — **no code change required**.

### What was built

- **`lib/member.ts` — `useMember()`, the single source of truth.** Returns one
  `address` and one `write()`. If a smart account exists it is preferred (and
  `gasless` is true); otherwise it falls back to the embedded EOA. Nothing else
  in the app may pick a wallet — this is what prevents the two-address bug.
  Verified: `grep` finds no wallet selection anywhere outside this file.
- **`lib/commitment.ts` — the pre-reveal guard.** Before sending a reveal, it
  re-runs the contract's own check locally (`commitmentOf` vs the recomputed
  hash) and refuses with a plain-English reason instead of firing a tx that
  reverts and gets the member **slashed**.
- **`providers.tsx`** mounts `SmartWalletsProvider` unconditionally (inert until
  enabled in the Dashboard).
- All member paths — join, commit, reveal, claim, approve, faucet, createCircle
  — now route through `useMember().write()`, so the identity is consistent.
- `permissionless` added: Privy's smart-wallets module needs it as a peer dep.

### To switch it on (your steps, no code)

1. **Privy Dashboard** → enable smart wallets → pick an account type (Safe/Kernel
   are the common choices) → add **Monad Testnet**.
2. **Pimlico** → create an account → API Keys → copy the **Monad Testnet**
   bundler + paymaster URLs.
3. **Privy Dashboard** → register that **paymaster URL** so Privy routes
   UserOperations through it.
4. **Fund the Pimlico paymaster** with MON.
5. Verify: sign in as a fresh user, confirm the Navbar shows the **smart account**
   address, and complete join → commit → reveal → claim with **zero MON**.

## Remaining verification (needs the keys above)

A wallet with **zero MON** must complete join → commit → reveal → claim. That is
the one test that proves the whole thing — it cannot be run until smart wallets
and the paymaster are live.

## Open risks

- **Cost**: sponsoring every member tx is an ongoing spend that scales with usage.
  Consider sponsoring only the critical path (`join`/`commit`/`reveal`) and
  letting `claim` be optional, or gating by circle.
- **Abuse**: an open paymaster funds anyone's txs. Scope the Pimlico policy to
  Bhishi's factory/circle addresses and specific selectors.
- **Smart-account migration**: existing testnet circles are joined by EOAs. Those
  members keep their EOA identity; only new users get smart accounts. Mixing is
  fine on-chain (both are just addresses) but confusing — worth a clean testnet
  reset when this lands.
- The Monad template is **React Native/Expo**; our app is Next.js. The Privy +
  Pimlico concepts transfer, but the provider setup differs — follow Privy's
  EVM smart-wallets docs for the web SDK rather than copying the template
  verbatim.
