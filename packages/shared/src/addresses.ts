// Deployed contract addresses. Edit by hand after each deploy — sync-abi.ts will
// NOT overwrite this file once it exists.
//
// Monad testnet (chain 10143) — redeployed 2026-07-17 with a real vrfOperator
// wired through the factory (B0), so only the keeper may call fulfillRandomness.
export const addresses = {
  monadTestnet: {
    factory: "0x4FA8F8a91AAB0909a01b63c6F63B7d9815de2570" as `0x${string}`,
    reputation: "0x17E0C571e8D0288dCC326C08591a7807a4D1F56D" as `0x${string}`,
    mockStable: "0x3dBaEf18B69E03D093b8C8920118Aa8D3c28048A" as `0x${string}`,
    circleImpl: "0x4F38e9B52018816394687D608639feeB624E11eB" as `0x${string}`,
  },
} as const;
