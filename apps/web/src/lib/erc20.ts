/* eslint-disable @typescript-eslint/no-explicit-any */
import { maxUint256 } from 'viem';
import { addresses, mockStableAbi } from './contracts';
import { publicClient, getWalletClient } from './wallet';

const STABLE = addresses.monadTestnet.mockStable;

/** Read the caller's mUSDC balance (6 decimals). */
export async function stableBalance(owner: `0x${string}`): Promise<bigint> {
  return (await publicClient.readContract({
    address: STABLE, abi: mockStableAbi as any, functionName: 'balanceOf', args: [owner],
  })) as bigint;
}

/** Read the caller's current mUSDC allowance to `spender`. */
export async function stableAllowance(owner: `0x${string}`, spender: `0x${string}`): Promise<bigint> {
  return (await publicClient.readContract({
    address: STABLE, abi: mockStableAbi as any, functionName: 'allowance', args: [owner, spender],
  })) as bigint;
}

/**
 * Ensure `spender` has at least `needed` mUSDC allowance from the user, sending a
 * max-approval tx (and waiting for it) only if the current allowance is short.
 * Returns once the allowance is sufficient so the caller can proceed to the
 * actual contract write. Throws if the user's balance can't cover `needed`.
 */
export async function ensureStableAllowance(
  embeddedWallet: any,
  userAddress: `0x${string}`,
  spender: `0x${string}`,
  needed: bigint,
): Promise<void> {
  const balance = await stableBalance(userAddress);
  if (balance < needed) {
    throw new Error(
      `Insufficient mUSDC: need ${(Number(needed) / 1e6).toFixed(2)}, have ${(Number(balance) / 1e6).toFixed(2)}. Use the faucet first.`,
    );
  }
  const current = await stableAllowance(userAddress, spender);
  if (current >= needed) return;

  const wc = await getWalletClient(embeddedWallet, userAddress);
  const hash = await wc.writeContract({
    address: STABLE, abi: mockStableAbi as any, functionName: 'approve', args: [spender, maxUint256],
  });
  await publicClient.waitForTransactionReceipt({ hash });
}
