/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { useSmartWallets } from '@privy-io/react-auth/smart-wallets';
import { encodeFunctionData } from 'viem';
import { monadTestnetChain } from './privy';
import { publicClient, getWalletClient } from './wallet';

/**
 * THE single source of truth for "who is this member on-chain" and "how do we
 * send their transactions".
 *
 * Why this file exists
 * --------------------
 * A Privy login yields an embedded wallet, which is an **EOA**. If smart wallets
 * are enabled in the Privy Dashboard, the user ALSO gets an ERC-4337 smart
 * account owned by that EOA — so the user has TWO addresses, and only the smart
 * account can have its gas sponsored.
 *
 * That is a trap. Circle.sol binds identity into the commit hash:
 *     commitment = keccak256(abi.encodePacked(amount, salt, msg.sender))
 * If the app commits as the smart account but reveals as the EOA (or vice
 * versa), the hashes don't match, `reveal()` reverts as InvalidReveal, and the
 * member is then SLASHED for "not revealing" — punished for our bug.
 *
 * So nothing else in the app may pick a wallet. Everything routes through
 * `useMember()`: one address, one sender, used for join/commit/reveal/claim
 * alike. Do not read `embeddedWallet.address` anywhere else.
 */
export interface Member {
  /** The member's on-chain identity. Undefined until authenticated. */
  address?: `0x${string}`;
  /** True when txs are sponsored (smart account active) — the user needs no MON. */
  gasless: boolean;
  ready: boolean;
  /** Send a contract write as this member. Returns the tx hash. */
  write: (args: { address: `0x${string}`; abi: any; functionName: string; args?: any[]; value?: bigint }) => Promise<`0x${string}`>;
}

export function useMember(): Member {
  const { user, ready: privyReady } = usePrivy();
  const { wallets } = useWallets();

  // useSmartWallets throws if SmartWalletsProvider isn't mounted; tolerate that
  // so the app still works with plain EOAs when smart wallets are disabled.
  let smartClient: any = undefined;
  try {
    smartClient = useSmartWallets().client;
  } catch {
    smartClient = undefined;
  }

  const embedded = wallets.find(w => w.walletClientType === 'privy');
  const smartAccount = user?.linkedAccounts?.find((a: any) => a.type === 'smart_wallet') as
    | { address?: string }
    | undefined;

  // Prefer the smart account when one exists — it is the sponsored identity.
  // Otherwise fall back to the embedded EOA. Chosen ONCE, here.
  const smartAddress = smartAccount?.address as `0x${string}` | undefined;
  const gasless = Boolean(smartAddress && smartClient);
  const address = (gasless ? smartAddress : (embedded?.address as `0x${string}` | undefined));

  async function write({
    address: to,
    abi,
    functionName,
    args = [],
    value,
  }: { address: `0x${string}`; abi: any; functionName: string; args?: any[]; value?: bigint }) {
    if (!address) throw new Error('Not signed in');

    if (gasless) {
      // Sponsored path: the paymaster registered in the Privy Dashboard pays gas,
      // so the member needs no MON at all.
      const hash = await smartClient.sendTransaction({
        chain: monadTestnetChain,
        to,
        data: encodeFunctionData({ abi, functionName, args }),
        ...(value !== undefined ? { value } : {}),
      });
      await publicClient.waitForTransactionReceipt({ hash });
      return hash as `0x${string}`;
    }

    // EOA path: the member pays their own gas.
    const wc = await getWalletClient(embedded, address);
    const hash = await wc.writeContract({ address: to, abi, functionName, args, ...(value !== undefined ? { value } : {}) });
    await publicClient.waitForTransactionReceipt({ hash });
    return hash as `0x${string}`;
  }

  return { address, gasless, ready: privyReady, write };
}
