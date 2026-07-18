/* eslint-disable @typescript-eslint/no-explicit-any */
import { addresses, mockStableAbi } from './contracts';
import { publicClient } from './wallet';
import type { MemberWrite } from './erc20';

const FAUCET_COOLDOWN_SECONDS = 24 * 60 * 60; // MockStable.FAUCET_COOLDOWN = 1 days

/** Hours remaining on the faucet cooldown for `owner`, or 0 if claimable now. */
export async function faucetCooldownHoursLeft(owner: `0x${string}`): Promise<number> {
  try {
    const last = (await publicClient.readContract({
      address: addresses.monadTestnet.mockStable,
      abi: mockStableAbi as any,
      functionName: 'lastFaucet',
      args: [owner],
    })) as bigint;
    if (last === 0n) return 0;
    const readyAt = Number(last) + FAUCET_COOLDOWN_SECONDS;
    const nowSec = Math.floor(Date.now() / 1000);
    const secsLeft = readyAt - nowSec;
    return secsLeft > 0 ? Math.ceil(secsLeft / 3600) : 0;
  } catch {
    return 0; // if the read fails, don't block the attempt
  }
}

/**
 * Claim 500 mUSDC from the MockStable faucet (1-day per-address cooldown).
 * Sent via the member's own identity (see lib/member.ts) so the funds land on
 * the same address that will join/commit.
 *
 * Checks the on-chain cooldown FIRST so we surface a clear "wait Nh" message
 * instead of letting the tx (or Privy's sponsorship pre-check) blow up with a
 * raw `0x62771006` (FaucetCooldown) selector the user can't interpret. Still
 * catches that selector as a fallback in case of a race.
 */
export async function claimFaucet(write: MemberWrite, userAddress: `0x${string}`) {
  const hoursLeft = await faucetCooldownHoursLeft(userAddress);
  if (hoursLeft > 0) {
    throw new Error(`Faucet already claimed — you have 500 mUSDC. Try again in ~${hoursLeft}h.`);
  }
  try {
    await write({
      address: addresses.monadTestnet.mockStable,
      abi: mockStableAbi as any,
      functionName: 'faucet',
    });
  } catch (e: any) {
    const msg = `${e?.shortMessage ?? ''} ${e?.details ?? ''} ${e?.message ?? ''}`;
    // Plain EOA reverts decode to the string "FaucetCooldown"; smart-account
    // UserOps instead surface the raw ABI-undecoded selector (0x62771006 =
    // keccak256("FaucetCooldown()").slice(0,4)) from the bundler's simulation
    // error, so match both forms.
    if (/FaucetCooldown/i.test(msg) || /0x62771006/i.test(msg)) {
      throw new Error('Faucet already claimed — try again after the 24h cooldown.');
    }
    throw e;
  }
}
