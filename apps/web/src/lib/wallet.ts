/* eslint-disable @typescript-eslint/no-explicit-any */
import { createPublicClient, createWalletClient, http, custom } from 'viem';
import { monadTestnetChain } from './privy';

/** Shared read-only client for Monad testnet. `batch.multicall` coalesces
 *  same-tick eth_call requests into one multicall3 call — several dashboard
 *  CircleCards reading in parallel would otherwise burst past the public
 *  RPC's 15 req/s cap ("requests limited to 15/sec"). */
export const publicClient = createPublicClient({
  chain: monadTestnetChain,
  transport: http(),
  batch: { multicall: true },
});

/**
 * Build a wallet client from a Privy embedded wallet. `embeddedWallet` is the
 * object returned by `useWallets().wallets.find(w => w.walletClientType === 'privy')`.
 */
export async function getWalletClient(embeddedWallet: any, userAddress: `0x${string}`) {
  if (!embeddedWallet) throw new Error('No embedded wallet');
  const provider = await embeddedWallet.getEthereumProvider();
  return createWalletClient({ account: userAddress, chain: monadTestnetChain, transport: custom(provider) });
}
