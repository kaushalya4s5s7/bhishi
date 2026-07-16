/* eslint-disable @typescript-eslint/no-explicit-any */
import { addresses, mockStableAbi } from './contracts';
import { publicClient, getWalletClient } from './wallet';

/**
 * Claim 500 mUSDC from the MockStable faucet (1-day per-address cooldown).
 * Waits for the tx to confirm. Throws with a friendly message on cooldown.
 */
export async function claimFaucet(embeddedWallet: any, userAddress: `0x${string}`) {
  const wc = await getWalletClient(embeddedWallet, userAddress);
  try {
    const hash = await wc.writeContract({
      address: addresses.monadTestnet.mockStable,
      abi: mockStableAbi as any,
      functionName: 'faucet',
    });
    await publicClient.waitForTransactionReceipt({ hash });
  } catch (e: any) {
    const msg = e?.shortMessage ?? e?.message ?? '';
    if (/FaucetCooldown/i.test(msg)) {
      throw new Error('Faucet already claimed — try again after the 24h cooldown.');
    }
    throw e;
  }
}
