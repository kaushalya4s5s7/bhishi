/* eslint-disable @typescript-eslint/no-explicit-any */
import { createPublicClient, createWalletClient, http, custom } from 'viem';
import { monadTestnetChain } from './privy';

/** Shared read-only client for Monad testnet. */
export const publicClient = createPublicClient({ chain: monadTestnetChain, transport: http() });

/**
 * Build a wallet client from a Privy embedded wallet. `embeddedWallet` is the
 * object returned by `useWallets().wallets.find(w => w.walletClientType === 'privy')`.
 */
export async function getWalletClient(embeddedWallet: any, userAddress: `0x${string}`) {
  if (!embeddedWallet) throw new Error('No embedded wallet');
  const provider = await embeddedWallet.getEthereumProvider();
  return createWalletClient({ account: userAddress, chain: monadTestnetChain, transport: custom(provider) });
}
