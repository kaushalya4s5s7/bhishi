/* eslint-disable @typescript-eslint/no-explicit-any */
import { keccak256, encodePacked, pad, toHex } from 'viem';
import { circleAbi } from './contracts';
import { publicClient } from './wallet';

const ZERO32 = ('0x' + '0'.repeat(64)) as `0x${string}`;

/**
 * Derive the bytes32 salt from the user's secret number, so they only have to
 * remember the number: the same secret always yields the same salt at commit
 * and at reveal.
 */
export function secretToSalt(secret: string): `0x${string}` {
  return pad(toHex(BigInt(secret)), { size: 32 });
}

/**
 * MUST match Circle.sol exactly:
 *     keccak256(abi.encodePacked(amount, salt, msg.sender))
 * Verified byte-for-byte against the contract's Solidity encoding.
 */
export function computeCommitment(amount: bigint, secret: string, member: `0x${string}`): `0x${string}` {
  return keccak256(encodePacked(['uint256', 'bytes32', 'address'], [amount, secretToSalt(secret), member]));
}

/**
 * Guard the reveal BEFORE spending a transaction on it.
 *
 * `reveal()` recomputes keccak256(amount, salt, msg.sender) and reverts if it
 * doesn't match what was committed. The most likely cause of a mismatch is an
 * identity mix-up (e.g. committed with the embedded EOA but revealing from the
 * smart account, or a wrong secret). Letting that tx fly is expensive: the
 * reveal reverts, the member looks like a no-show, and the slash path takes
 * their bond — punished for our bug.
 *
 * So we do the contract's own check locally first and fail loudly instead.
 * Returns null when it's safe to proceed, or a human-readable reason.
 */
export async function checkRevealWillSucceed(
  circleAddress: `0x${string}`,
  member: `0x${string}`,
  amount: bigint,
  secret: string,
): Promise<string | null> {
  let stored: string;
  try {
    stored = (await publicClient.readContract({
      address: circleAddress,
      abi: circleAbi as any,
      functionName: 'commitmentOf',
      args: [member],
    })) as string;
  } catch {
    return null; // Can't read — let the contract be the judge rather than block.
  }

  if (!stored || stored === ZERO32) {
    return `This wallet (${member.slice(0, 6)}…${member.slice(-4)}) has no commitment for this round. If you joined with a different wallet, switch to it — revealing from the wrong one will fail and can cost your bond.`;
  }

  const expected = computeCommitment(amount, secret, member);
  if (expected.toLowerCase() !== stored.toLowerCase()) {
    return 'That secret does not match what this wallet committed. Double-check the number you saved — revealing with the wrong secret will fail and can cost your bond.';
  }
  return null;
}
