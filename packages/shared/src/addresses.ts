// Deployed contract addresses. Edit by hand after each deploy — sync-abi.ts will
// NOT overwrite this file once it exists.
//
// Monad testnet (chain 10143) — redeployed 2026-07-19 for the Design A fix
// (winners pay every round; persistent bid history). Reuses the existing
// MockStable so members' mUSDC balances stay valid; Circle impl, Factory, and
// ReputationRegistry are new (ReputationRegistry.factory is immutable, so a
// new factory required a new registry too). Wired to REAL Pyth Entropy
// (0x825c0390f379C631f3Cf11A82a37D20BddF93c07) for verifiable drand
// randomness. Draws are fulfilled by Pyth's keeper; the circle sponsors the
// fee from its own balance so members never spend native MON.
//
// NOTE: circles created on the OLD factory (0x384597AE10181bC7215f4a57aF6caAe1a6eE26dc)
// are unaffected and keep running on the old (buggy) Circle implementation —
// see DESIGN_A_PLAN.md Part 7 re: the stuck 0x3e1A…9a8F circle.
export const addresses = {
  monadTestnet: {
    factory: "0x4196BBaAB023458678379DDa68c5093e2c046D48" as `0x${string}`,
    reputation: "0xEfAc337fD02F1060f7763C7a213feb0AC2B12068" as `0x${string}`,
    mockStable: "0xDc97E76aC1e5F1Ce0488Ad07a139e2632Bd1487a" as `0x${string}`,
    circleImpl: "0xbffecAADE520A17a6728aC8cDc2A1e7F60266A74" as `0x${string}`,
    pythEntropy: "0x825c0390f379C631f3Cf11A82a37D20BddF93c07" as `0x${string}`,
  },
} as const;
