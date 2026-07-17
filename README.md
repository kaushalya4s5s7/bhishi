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

Live on Monad testnet (chain `10143`), wired to **real Pyth Entropy** for verifiable
randomness. Click any address to open it in the explorer.

| Contract | What it does | Address |
|----------|--------------|---------|
| **CircleFactory** | Creates new savings circles (one-click clones) | [`0x384597AE10181bC7215f4a57aF6caAe1a6eE26dc`](https://testnet.monadexplorer.com/address/0x384597AE10181bC7215f4a57aF6caAe1a6eE26dc) |
| **Circle** (implementation) | The circle logic all clones share | [`0x0785C9d98130791f0f0644a65b39f0a20b2DdA0d`](https://testnet.monadexplorer.com/address/0x0785C9d98130791f0f0644a65b39f0a20b2DdA0d) |
| **ReputationRegistry** | Records who paid on time / who defaulted | [`0x9d1bA8144DF7cE5A60f3378adBE87A3a97Aa4F02`](https://testnet.monadexplorer.com/address/0x9d1bA8144DF7cE5A60f3378adBE87A3a97Aa4F02) |
| **MockStable** (mUSDC) | Test stablecoin with a free faucet | [`0xDc97E76aC1e5F1Ce0488Ad07a139e2632Bd1487a`](https://testnet.monadexplorer.com/address/0xDc97E76aC1e5F1Ce0488Ad07a139e2632Bd1487a) |
| **Pyth Entropy** (external) | Delivers verifiable drand randomness for every draw | [`0x825c0390f379C631f3Cf11A82a37D20BddF93c07`](https://testnet.monadexplorer.com/address/0x825c0390f379C631f3Cf11A82a37D20BddF93c07) |

### Verifiable randomness — proven on-chain

Every draw is settled by **Pyth Entropy's keeper**, not by us: the circle emits a
request, Pyth's off-chain nodes fetch a [drand](https://drand.love) random number and
call back. The circle **sponsors the fee from its own balance** (~0.126 MON/draw), so
members never spend native tokens. Both modes were run end-to-end against the live
contracts above:

| Mode | What Pyth did | requestDraw | Pyth fulfilment (winner drawn) |
|------|---------------|-------------|-------------------------------|
| **Lucky draw** | Picked the winner at random | [`0x57d01838…`](https://testnet.monadexplorer.com/tx/0x57d018382a640cb3df8de96152434a7b400bc3ac4c8b32e2dc6490305b34fa93) | [`0xe7fea65e…`](https://testnet.monadexplorer.com/tx/0xe7fea65e6701320eeba6ba8e87597acaec936d3f9dc2f050e9202a091c14aee8) |
| **Auction** | Broke a tie between equal bids | [`0xc845ff78…`](https://testnet.monadexplorer.com/tx/0xc845ff7869c4e09e145ec31c0267dc9e27fc0ff2f33e1b20fa250170e68b8a63) | [`0x9bf9cd19…`](https://testnet.monadexplorer.com/tx/0x9bf9cd19f0f22691c46631cdec4062985328dbef929be9eeeafed685ac59319f) |

In both fulfilment txs the **sender is a Pyth keeper address** (not the deployer) and
the `to` is Pyth's Entropy contract — the randomness is genuinely external. This is
"trust the math, not the person" made literal: no human, including the organizer,
chooses the winner.

## A Real Auction Circle, Start to Finish (live on-chain)

> **Which deployment:** the two step-by-step walkthroughs below are from an **earlier
> permissionless deployment** (before the Pyth Entropy integration), where the draw was
> settled directly rather than by Pyth's keeper. They're kept because they show a
> *complete* 3-round cycle end-to-end — every commit, reveal, and settlement. For the
> **current, Pyth-verified** contracts and the real external-randomness draws, see
> [Deployed Contracts](#deployed-contracts-monad-testnet) and
> [Verifiable randomness — proven on-chain](#verifiable-randomness--proven-on-chain) above.
> All transactions here remain real and verifiable on the explorer.

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

## The Other Mode: A Lucky-Draw Circle, Start to Finish (live on-chain)

Bhishi has a second mode — **lucky-draw** — where the winner each round is picked at
**random** (via verifiable randomness) instead of by bidding. We ran a full one of these
too: 3 people, 3 rounds, everyone wins once.

**How it differs from the auction:** there's no bidding and no dividend. Every round each
member simply pays their **10 mUSDC** into the pot, and one member is drawn **at random** to
take the **whole 30 mUSDC pot**. Just like a real rotating savings group ("chit"/"committee"),
**past winners keep paying in every round** — they just can't be drawn again until everyone
has had their turn.

**Setup** ([circle `0x1747d6be…`](https://testnet.monadexplorer.com/address/0x1747d6beae5b3759da8918b400d750109e397ae1)):

| # | Step | In plain English | Transaction |
|---|------|------------------|-------------|
| 1 | Join ×3 | Each member stakes their 20 mUSDC bond and takes a seat | [`0xf6497c28…`](https://testnet.monadexplorer.com/tx/0xf6497c28374af95fa562a8dee1f15887f858851a62316250a5404be3bcbf4a3c) · [`0x9c09d72b…`](https://testnet.monadexplorer.com/tx/0x9c09d72b4e6361fb93603bc28cc64123fecda38985ea16aa9c018fe3607dc1be) · [`0xe114fbb4…`](https://testnet.monadexplorer.com/tx/0xe114fbb45725fc1e9693846f397edd317d580c6415f311590c08b953dfaf8586) |

**Round 1** — everyone pays in, then a random winner is drawn:

| # | Step | In plain English | Transaction |
|---|------|------------------|-------------|
| 2 | Commit ×3 | Each member pays their 10 mUSDC into the pot | [`0x3c1fe692…`](https://testnet.monadexplorer.com/tx/0x3c1fe692818d5b550d5299e7b33ea924d7a4cbda7c973cb0afc7b9cf97bf6f99) · [`0x7fa83dd3…`](https://testnet.monadexplorer.com/tx/0x7fa83dd31b2e86bf253cf2a19d74ec8ee6d2d456d69774c82f0fe23e3adce0db) · [`0x5071ae9e…`](https://testnet.monadexplorer.com/tx/0x5071ae9e2cc1e500eb7e9dcce166bc7f37b5db3f8482f8bb7700e55789667070) |
| 3 | Open + reveal ×3 | The round opens and everyone confirms their entry | [`0x1f3af14d…`](https://testnet.monadexplorer.com/tx/0x1f3af14dd0330815a8ce5fd9531c529ce7b7a916836c2d2c15e3d941efab7ab5) · [`0xabe0cdaf…`](https://testnet.monadexplorer.com/tx/0xabe0cdaf9a8336640d21a91dbcf2ae8a6209025d3d43964fcfa2b3887a61cdbc) · [`0x3782d298…`](https://testnet.monadexplorer.com/tx/0x3782d298f061671beee2dd2617bfcba4406be26be2796dfd4feb0ca9b425cd46) · [`0x18b1cf8e…`](https://testnet.monadexplorer.com/tx/0x18b1cf8ebb14365eb7198dc5f0ef7ab7c50baccb4ed983881d20a4092b95028b) |
| 4 | Draw winner | Randomness picks the winner; **full 30 mUSDC pot** is theirs | [`0xa3344db3…`](https://testnet.monadexplorer.com/tx/0xa3344db350c4aa52ab7162a75eedf0fe91ff62859dd419dd41f2b4ec262fa3f2) → [`0x346eedde…`](https://testnet.monadexplorer.com/tx/0x346eedde9628ba8faacadd6112998e3a6f723217c2f254d6706bde2eaaf47ee0) |

**Round 2** — the round-1 winner keeps paying in but can't be drawn again:

| # | Step | In plain English | Transaction |
|---|------|------------------|-------------|
| 5 | Commit + reveal ×3 | All three pay in again (winner included) and confirm | [`0x7019d810…`](https://testnet.monadexplorer.com/tx/0x7019d81099160e9a5b4680df7559414ef49fd9c31cfbef2bdb08743e58115c23) · [`0x22012d90…`](https://testnet.monadexplorer.com/tx/0x22012d90d832112094ff0c9a8656cd27fc0a4409a577008c97f1811e7661260a) · [`0xf72dcc18…`](https://testnet.monadexplorer.com/tx/0xf72dcc18007599ff1c3559e3bfc0cda000331e8b56940dd4aae873972c8fce0f) |
| 6 | Draw winner | One of the two remaining is drawn; takes the pot | [`0x7cae5c67…`](https://testnet.monadexplorer.com/tx/0x7cae5c6736e8f78d7446fa7ef393de6a75749d62e13f3d8eb48feb685748894e) → [`0xedb610dd…`](https://testnet.monadexplorer.com/tx/0xedb610dd719f40296a3fde572f3ef9ace48b519047de7df747f180f8b3a07482) |

**Round 3 (final)** — only one member hasn't won, so they win and the circle closes:

| # | Step | In plain English | Transaction |
|---|------|------------------|-------------|
| 7 | Commit + reveal ×3 | Final round paid in and confirmed | [`0xe9692578…`](https://testnet.monadexplorer.com/tx/0xe9692578ce514ba47e57ddb3c840b1872e0484de928a8b579a7e3acf74721d86) · [`0x4218870d…`](https://testnet.monadexplorer.com/tx/0x4218870d20e3673988692d79909f1dfcee06b0b28e6f7ed12e239800d79f3701) · [`0x52da7154…`](https://testnet.monadexplorer.com/tx/0x52da7154f218091ece2c7bcbf0d5c4ed7d66beeba87048ee3d9df0ec5062df83) |
| 8 | Draw + **complete** | Last member wins, bonds returned, circle **COMPLETED** | [`0x08823ae4…`](https://testnet.monadexplorer.com/tx/0x08823ae4ba972f5ead2afcab024430477b225aa7ee515894cbac5c3701f1e489) → [`0x0abc778a…`](https://testnet.monadexplorer.com/tx/0x0abc778ac531bca105e85c62e5a9871c805ce458d1ef13f5d321d915c6a2ea2c) |

**The result:** all 3 members won exactly once (each ending with 50 mUSDC — the 30 pot they
won plus their 20 bond back), the circle reached **COMPLETED**, and the conservation check
held after every round. Same guarantees as the auction — just a random winner instead of a
bid-based one.

> Both walkthrough circles above are still on-chain and show `state = COMPLETED`
> ([auction `0x509b1505…`](https://testnet.monadexplorer.com/address/0x509b1505a382510cfcd5ae903332c2c728842f07),
> [lucky-draw `0x1747d6be…`](https://testnet.monadexplorer.com/address/0x1747d6beae5b3759da8918b400d750109e397ae1)).
> On the **current Pyth-wired deployment**, the same flows were re-run and each winner was
> drawn by Pyth's keeper from drand — see the [randomness table](#verifiable-randomness--proven-on-chain) above.

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
