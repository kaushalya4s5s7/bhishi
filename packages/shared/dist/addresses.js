// Deployed contract addresses. Edit by hand after each deploy — sync-abi.ts will
// NOT overwrite this file once it exists.
//
// Monad testnet (chain 10143) — redeployed 2026-07-17 wired to REAL Pyth Entropy
// (0x825c0390f379C631f3Cf11A82a37D20BddF93c07) for verifiable drand randomness.
// Draws are fulfilled by Pyth's keeper; the circle sponsors the fee from its own
// balance so members never spend native MON.
export const addresses = {
    monadTestnet: {
        factory: "0x384597AE10181bC7215f4a57aF6caAe1a6eE26dc",
        reputation: "0x9d1bA8144DF7cE5A60f3378adBE87A3a97Aa4F02",
        mockStable: "0xDc97E76aC1e5F1Ce0488Ad07a139e2632Bd1487a",
        circleImpl: "0x0785C9d98130791f0f0644a65b39f0a20b2DdA0d",
        pythEntropy: "0x825c0390f379C631f3Cf11A82a37D20BddF93c07",
    },
};
