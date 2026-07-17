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

## Scope / order

1. Privy Dashboard: enable smart wallets; Pimlico: get Monad Testnet URLs; register
   paymaster in Privy. *(no code)*
2. `apps/web`: add smart-wallet provider; route member address + writes through
   the smart account (`lib/wallet.ts` is the single seam).
3. Verify on testnet: a wallet with **zero MON** completes join → commit →
   reveal → claim.
4. Fund + monitor the paymaster; consider limits (a sponsored endpoint is
   abusable — Pimlico supports sponsorship policies; scope them to Bhishi's
   contract addresses).

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
