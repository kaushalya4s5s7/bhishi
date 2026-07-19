/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { useSmartWallets } from '@privy-io/react-auth/smart-wallets';
import { encodeFunctionData } from 'viem';
import { monadTestnetChain } from './privy';
import { publicClient, getWalletClient } from './wallet';

/**
 * viem's waitForTransactionReceipt resolves once a receipt exists — it does
 * NOT throw on `status: 'reverted'`. Without this check, a reverted approve
 * (or any reverted tx) is silently treated as success, and the caller
 * proceeds as if the on-chain effect happened — e.g. join() then fails with
 * a bare, undecoded "execution reverted" because the approve never landed.
 */
async function waitForSuccess(hash: `0x${string}`) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') {
    throw new Error(`Transaction reverted on-chain (${hash})`);
  }
  return receipt;
}

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
// Monad testnet's eth_estimateGas can under-estimate proxy-clone calls (e.g.
// createCircle's Clones.clone() + cross-contract initialize()), so txs that hit
// that path can revert out-of-gas at exactly the estimated limit. Pad every
// estimate before submitting.
const GAS_BUFFER_NUM = 13n;
const GAS_BUFFER_DEN = 10n;

export interface Member {
  /** The member's on-chain identity. Undefined until authenticated. */
  address?: `0x${string}`;
  /** True when txs are sponsored (smart account active) — the user needs no MON. */
  gasless: boolean;
  ready: boolean;
  /** Send a contract write as this member. Returns the tx hash. */
  write: (args: { address: `0x${string}`; abi: any; functionName: string; args?: any[]; value?: bigint }) => Promise<`0x${string}`>;
  /**
   * The embedded EOA address — the ONE identity that can actually hold and spend
   * native MON. `undefined` until the wallet resolves. Use it to check MON
   * balance and to tell the user which address to fund.
   */
  eoaAddress?: `0x${string}`;
  /**
   * Send a VALUE-BEARING write from the embedded EOA, never the smart account.
   *
   * A paymaster sponsors gas only — it cannot supply `msg.value`. So any tx that
   * attaches native MON (createCircle's VRF pre-funding) MUST come from the EOA,
   * which can hold MON. This is safe to route separately because createCircle is
   * NOT a member action: the creator identity is independent of the join/commit/
   * reveal identity, so it doesn't break the commit-hash single-identity rule.
   */
  writeValue: (args: { address: `0x${string}`; abi: any; functionName: string; args?: any[]; value?: bigint }) => Promise<`0x${string}`>;
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
  // In @privy-io/react-auth@3.35.1 (the version pinned here), a linked smart
  // account is its own discriminated type: `SmartWalletWithMetadata` with
  // `type: 'smart_wallet'` (see node_modules/@privy-io/react-auth's
  // types-*.d.ts). Do not "fix" this to `type === 'wallet'` — that shape is
  // from a different/newer SDK version and doesn't match what's installed.
  const smartAccount = user?.linkedAccounts?.find((a: any) => a.type === 'smart_wallet') as
    | { address?: string }
    | undefined;

  // `smartClient` is present exactly when the app has smart wallets enabled
  // (SmartWalletsProvider mounted + SDK config). When it is, EVERY member action
  // must be sponsored — the embedded EOA has no MON and must never be the sender.
  const smartWalletsExpected = Boolean(smartClient);
  const smartAddress = smartAccount?.address as `0x${string}` | undefined;
  const gasless = Boolean(smartAddress && smartClient);

  // Identity selection — chosen ONCE, here.
  //  • Smart wallets expected: use the smart account, and NEVER fall back to the
  //    EOA. On a fresh login the smart account lands in user.linkedAccounts a few
  //    ticks AFTER the embedded EOA appears; falling back during that window is
  //    the race that sends an unsponsored EOA tx → "Signer had insufficient
  //    balance". So while it is still linking, address stays undefined (member
  //    not ready) rather than resolving early to the EOA.
  //  • Smart wallets disabled: plain-EOA app, use the embedded EOA as before.
  const address = smartWalletsExpected
    ? smartAddress
    : (embedded?.address as `0x${string}` | undefined);

  async function write({
    address: to,
    abi,
    functionName,
    args = [],
    value,
  }: { address: `0x${string}`; abi: any; functionName: string; args?: any[]; value?: bigint }) {
    if (!address) throw new Error('Not signed in');

    // Sponsorship is expected but the smart account has not finished linking.
    // Do NOT quietly send from the EOA (it has no MON) — that is exactly the
    // race this guard exists to stop. Ask the caller to retry in a moment.
    if (smartWalletsExpected && !gasless) {
      throw new Error('Setting up your sponsored wallet — one moment, then try again.');
    }

    if (gasless) {
      // Sponsored path: the paymaster registered in the Privy Dashboard pays gas,
      // so the member needs no MON at all.
      const hash = await smartClient.sendTransaction({
        chain: monadTestnetChain,
        to,
        data: encodeFunctionData({ abi, functionName, args }),
        ...(value !== undefined ? { value } : {}),
      });
      await waitForSuccess(hash);
      return hash as `0x${string}`;
    }

    // EOA path: the member pays their own gas.
    const wc = await getWalletClient(embedded, address);
    const estimated = await publicClient.estimateContractGas({
      account: address,
      address: to,
      abi,
      functionName,
      args,
      ...(value !== undefined ? { value } : {}),
    });
    const gas = (estimated * GAS_BUFFER_NUM) / GAS_BUFFER_DEN;
    const hash = await wc.writeContract({ address: to, abi, functionName, args, gas, ...(value !== undefined ? { value } : {}) });
    await waitForSuccess(hash);
    return hash as `0x${string}`;
  }

  const eoaAddress = embedded?.address as `0x${string}` | undefined;

  // Always the EOA — the only identity that can hold/spend native MON. Used for
  // value-bearing txs (createCircle) that a paymaster can't sponsor.
  async function writeValue({
    address: to,
    abi,
    functionName,
    args = [],
    value,
  }: { address: `0x${string}`; abi: any; functionName: string; args?: any[]; value?: bigint }) {
    if (!eoaAddress) throw new Error('Wallet not ready');
    const wc = await getWalletClient(embedded, eoaAddress);
    const estimated = await publicClient.estimateContractGas({
      account: eoaAddress,
      address: to,
      abi,
      functionName,
      args,
      ...(value !== undefined ? { value } : {}),
    });
    const gas = (estimated * GAS_BUFFER_NUM) / GAS_BUFFER_DEN;
    const hash = await wc.writeContract({ address: to, abi, functionName, args, gas, ...(value !== undefined ? { value } : {}) });
    await waitForSuccess(hash);
    return hash as `0x${string}`;
  }

  // Ready only once Privy is up AND (if not authenticated) or the sender
  // identity has actually resolved. When smart wallets are expected this stays
  // false through the smart-account linking window, keeping claim/join buttons
  // in their "Preparing wallet…" state instead of firing an unsponsored EOA tx.
  const ready = privyReady && (!user || Boolean(address));

  return { address, gasless, ready, write, eoaAddress, writeValue };
}
