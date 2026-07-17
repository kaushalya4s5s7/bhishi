/* eslint-disable @typescript-eslint/no-explicit-any */
import { addresses, mockStableAbi } from './contracts';
import type { MemberWrite } from './erc20';

/**
 * Claim 500 mUSDC from the MockStable faucet (1-day per-address cooldown).
 * Sent via the member's own identity (see lib/member.ts) so the funds land on
 * the same address that will join/commit. Throws a friendly cooldown message.
 */
export async function claimFaucet(write: MemberWrite, _userAddress: `0x${string}`) {
  try {
    await write({
      address: addresses.monadTestnet.mockStable,
      abi: mockStableAbi as any,
      functionName: 'faucet',
    });
  } catch (e: any) {
    const msg = e?.shortMessage ?? e?.message ?? '';
    if (/FaucetCooldown/i.test(msg)) {
      throw new Error('Faucet already claimed — try again after the 24h cooldown.');
    }
    throw e;
  }
}
