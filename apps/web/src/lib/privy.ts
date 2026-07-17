export const monadTestnetChain = {
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.NEXT_PUBLIC_MONAD_RPC_URL ?? 'https://testnet-rpc.monad.xyz'] },
  },
  blockExplorers: {
    default: { name: 'Monad Explorer', url: 'https://testnet.monadexplorer.com' },
  },
} as const;

export const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? 'placeholder-app-id';
export const privyConfig = {
  loginMethods: ['email', 'google'] as const,
  appearance: { theme: 'light' as const, accentColor: '#7C3AED' },
  // Privy v3 nests embedded-wallet config under `ethereum` (and `solana`). The
  // old FLAT `{ createOnLogin }` shape is silently ignored — Ethereum then falls
  // back to its default of 'off', so NO embedded wallet is ever created and
  // useWallets() stays empty forever (address never resolves → buttons stuck on
  // "Preparing wallet…"). It must be nested.
  embeddedWallets: { ethereum: { createOnLogin: 'users-without-wallets' as const } },
  defaultChain: monadTestnetChain,
  supportedChains: [monadTestnetChain],
};
