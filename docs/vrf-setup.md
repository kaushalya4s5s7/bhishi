# Gelato VRF Setup (Monad Testnet)

How to deploy Bhishi with **trustless randomness**. Gelato VRF is confirmed to
support Monad Testnet (see Gelato's *VRF → Supported Networks*, which lists
"Monad, Testnet").

## How it actually works (read this first)

Gelato VRF is **event-driven, not API-driven**. There is no endpoint for a
backend keeper to call:

1. `Circle.requestDraw()` calls `_requestRandomness("")` on the vendored
   `GelatoVRFConsumerBase`, which emits `RequestedRandomness(round, data)`.
2. **Gelato's nodes watch for that event** and fetch the corresponding
   [drand](https://drand.love) round.
3. They call `fulfillRandomness(randomness, dataWithRound)` on the circle from
   their **dedicated msg.sender**.
4. The base verifies `msg.sender == _operator()`, re-checks the request hash,
   domain-separates the randomness with `(randomness, address(this), chainid,
   requestId)`, then invokes our `_fulfillRandomness` — which picks the winner.

Consequence: **no VRF keeper worker is needed.** Gelato does the fulfilment.

## Setup order — this matters

`vrfOperator` is **immutable** on `CircleFactory`. Getting the order wrong means
a full redeploy.

### 1. Get the dedicated msg.sender BEFORE deploying

It is assigned to your **deployer address**, not to the deployed contract.

- Go to **<https://app.gelato.cloud>** (note: `app.gelato.network` is the
  deprecated domain).
- Connect the deployer wallet.
- Read off the **dedicated msg.sender** for that address.

### 2. Fund the deployer

Deployment + a lifecycle run costs real testnet MON. Top up from a Monad testnet
faucet.

### 3. Deploy with the operator baked in

```bash
cd packages/contracts
VRF_OPERATOR=<dedicated msg.sender> \
  forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$MONAD_RPC_URL" --broadcast --slow
```

The script warns loudly if `VRF_OPERATOR` is unset — in that case circles are
**permissionless** (anyone can fulfil a draw with randomness they chose). That is
acceptable only for local/demo, never for anything holding value.

### 4. Create the VRF task

In the Gelato app, create the VRF task on **Monad Testnet** pointing at the
deployed Circle. Only now will `RequestedRandomness` events be answered.

### 5. Update addresses

Put the new addresses in `packages/shared/src/addresses.ts` (hand-edited;
`sync-abi.ts` will not overwrite it).

## Verifying it worked

```bash
# The factory's operator should equal the dedicated msg.sender:
cast call <FACTORY> 'vrfOperator()(address)' --rpc-url "$MONAD_RPC_URL"

# A new circle must inherit it (NOT address(0)):
cast call <CIRCLE> 'vrfOperator()(address)' --rpc-url "$MONAD_RPC_URL"

# A non-operator must be rejected:
cast call <CIRCLE> 'fulfillRandomness(uint256,bytes)' 1 0x \
  --from 0x000000000000000000000000000000000000dEaD --rpc-url "$MONAD_RPC_URL"
# expected: revert "only operator"
```

## Gotchas found the hard way

- **The base SILENTLY no-ops on a payload hash mismatch** — no revert, no draw.
  If a draw never lands, suspect the `dataWithRound` payload
  (`abi.encode(round, abi.encode(requestId, extraData))`), the round, or the
  requestId. `test/mocks/MockVRF.sol` deliberately `require`s a hash match so
  tests fail loudly instead.
- **`_round()` depends on `block.timestamp`**, so the round must be the one from
  the block in which `requestDraw()` ran — not fulfilment time.
- **`requestId` is per-circle and increments from 0** on every
  `_requestRandomness`. It is *not* the circle's round number.
- **Foundry's default `block.timestamp` is 1**, and the base subtracts drand's
  genesis (Aug 2023) → underflow. `foundry.toml` sets a realistic
  `block_timestamp` so tests match a real chain.
- **Inheriting the base shifted Circle's storage slots** (its
  `requestPending`/`requestedHash` come first). Re-check with
  `forge inspect Circle storage` before relying on any slot index.

## Liveness: what if Gelato never answers?

Funds are never stuck. `requestDraw()` records `drawRequestedAt`; after
`VRF_TIMEOUT` the circle can be moved to `STALLED` and **anyone** may call
`reclaimOnStall()` to return the pool and bonds. The VRF is a liveness
convenience, never a custody dependency.
