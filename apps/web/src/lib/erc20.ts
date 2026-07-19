/* eslint-disable @typescript-eslint/no-explicit-any */
import { maxUint256 } from 'viem';
import { addresses, mockStableAbi } from './contracts';
import { publicClient } from './wallet';

/** Sends a contract write as the member — supplied by useMember() so approvals
 *  go out from the SAME identity that will join/commit (see lib/member.ts). */
export type MemberWrite = (a: {
  address: `0x${string}`; abi: any; functionName: string; args?: any[]; value?: bigint;
}) => Promise<`0x${string}`>;

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
  write: MemberWrite,
  userAddress: `0x${string}`,
  spender: `0x${string}`,
  needed: bigint,
): Promise<void> {
  const balance = await stableBalance(userAddress);
  // TEMP DEBUG — remove once the join()-without-approve bug is found.
  console.log('[allowance-debug] balance check', { userAddress, spender, needed: needed.toString(), balance: balance.toString() });
  if (balance < needed) {
    throw new Error(
      `Insufficient mUSDC: need ${(Number(needed) / 1e6).toFixed(2)}, have ${(Number(balance) / 1e6).toFixed(2)}. Use the faucet first.`,
    );
  }
  const current = await stableAllowance(userAddress, spender);
  // TEMP DEBUG — remove once the join()-without-approve bug is found.
  console.log('[allowance-debug] allowance check', { userAddress, spender, needed: needed.toString(), current: current.toString(), willApprove: current < needed });
  if (current >= needed) return;

  console.log('[allowance-debug] sending approve()', { spender });
  const hash = await write({ address: STABLE, abi: mockStableAbi as any, functionName: 'approve', args: [spender, maxUint256] });
  console.log('[allowance-debug] approve() confirmed', { hash });

  const after = await stableAllowance(userAddress, spender);
  console.log('[allowance-debug] allowance after approve', { after: after.toString(), sufficientNow: after >= needed });
}
