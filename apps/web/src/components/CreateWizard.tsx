/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';
import { useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { formatEther, parseEventLogs } from 'viem';
import { addresses, circleFactoryAbi } from '@/lib/contracts';
import { publicClient } from '@/lib/wallet';
import { useMember } from '@/lib/member';
import { apiUrl } from '@/lib/api';
import { confirmTransaction } from '@/lib/transactions';
import { Button } from '@/components/ui';
import { createInvites, parseEmails } from '@/lib/invites';

interface CreateWizardProps {
  onSuccess?: (addr: string) => void;
}

// mUSDC has 6 decimals; UI inputs are whole mUSDC units.
const toUnits = (n: number) => BigInt(Math.round(n * 1e6));

type Mode = 0 | 1; // 0 = LUCKY_DRAW, 1 = AUCTION

export function CreateWizard({ onSuccess }: CreateWizardProps = {}) {
  const { authenticated, login, ready: privyReady, getAccessToken } = usePrivy();
  // createCircle attaches native MON (VRF pre-funding), which a paymaster can't
  // sponsor. So before creating, we ask the backend relayer to top up the user's
  // smart account with the exact shortfall; the create then runs GASLESS via the
  // smart account (write), keeping creator = the user's smart account so the
  // dashboard and VRF refund stay correct. See lib/member.ts + api/sponsor.
  const { address: userAddress, write } = useMember();

  // Authenticated but no address yet = the embedded/smart wallet is still
  // resolving asynchronously (useWallets populates a tick after login). Until it
  // lands, createCircle has no `msg.sender` to refund VRF to, so we must NOT let
  // the user click through — otherwise handleCreate silently re-calls login()
  // and the button appears dead. See the disabled + label logic below.
  const walletResolving = authenticated && !userAddress;

  const [seats, setSeats] = useState(4);
  const [contribution, setContribution] = useState(100);
  const [bond, setBond] = useState(300);
  const [mode, setMode] = useState<Mode>(0);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [vrfQuote, setVrfQuote] = useState<bigint | null>(null);
  const [inviteEmails, setInviteEmails] = useState('');

  // Quote the MON needed to sponsor every draw, so the creator sees the cost
  // before signing rather than being surprised by a value-bearing tx.
  useEffect(() => {
    let cancelled = false;
    publicClient
      .readContract({
        address: addresses.monadTestnet.factory,
        abi: circleFactoryAbi as any,
        functionName: 'vrfFundingFor',
        args: [BigInt(seats)],
      })
      .then(q => { if (!cancelled) setVrfQuote(q as bigint); })
      .catch(() => { if (!cancelled) setVrfQuote(null); });
    return () => { cancelled = true; };
  }, [seats]);

  // Mirror on-chain bond gate: bond >= (seats-1) * contribution
  const minBond = (seats - 1) * contribution;
  const bondValid = bond >= minBond;
  const seatsValid = seats >= 2 && seats <= 20;

  const handleCreate = async () => {
    // Not signed in at all → start login and stop; the click after auth creates.
    if (!authenticated) { await login(); return; }
    // Signed in but the wallet hasn't materialised yet. Calling login() here is a
    // silent no-op (already authenticated), which is exactly what made the button
    // look broken. Surface it instead so the user knows to wait a moment.
    if (!userAddress) {
      setError('Setting up your wallet — one moment, then tap Create again.');
      return;
    }
    if (!seatsValid) { setError('Seats must be between 2 and 20'); return; }
    if (!bondValid) { setError(`Bond must be at least ${minBond} mUSDC`); return; }
    setCreating(true);
    setError('');
    try {
      // The circle sponsors its own Pyth Entropy fee for every draw, so members
      // never spend native MON. Fund all `seats` rounds up front in this same tx
      // — otherwise requestDraw() later reverts with InsufficientVrfFunding.
      // Leftover MON is refunded to the creator when the circle completes.
      const vrfFunding = (await publicClient.readContract({
        address: addresses.monadTestnet.factory,
        abi: circleFactoryAbi as any,
        functionName: 'vrfFundingFor',
        args: [BigInt(seats)],
      })) as bigint;

      // A paymaster sponsors gas only, never msg.value — so if the smart account
      // can't cover the VRF funding, ask the backend relayer to top it up with
      // the exact shortfall (bound to our verified session; the API only ever
      // funds our own address). Then the create runs GASLESS from the smart
      // account, keeping creator = us. If sponsorship is unavailable we surface a
      // clear "fund your wallet" message rather than a cryptic on-chain revert.
      const monBalance = await publicClient.getBalance({ address: userAddress });
      if (monBalance < vrfFunding) {
        try {
          const token = await getAccessToken();
          const res = await fetch(apiUrl('/api/sponsor/create-funding'), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ seats }),
          });
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body?.message ?? `Sponsorship failed (${res.status})`);
          }
          // Wait until the top-up actually lands before we send the create tx.
          for (let i = 0; i < 30; i++) {
            const bal = await publicClient.getBalance({ address: userAddress });
            if (bal >= vrfFunding) break;
            await new Promise(r => setTimeout(r, 1000));
          }
        } catch (sponsorErr: any) {
          setError(
            `Couldn't cover the randomness funding automatically (${sponsorErr?.message ?? 'sponsor error'}). ` +
            `You can send ${formatEther(vrfFunding)} testnet MON to ${userAddress.slice(0, 6)}…${userAddress.slice(-4)} and retry.`,
          );
          setCreating(false);
          return;
        }
      }

      const hash = await write({
        address: addresses.monadTestnet.factory,
        abi: circleFactoryAbi as any,
        functionName: 'createCircle',
        args: [toUnits(contribution), BigInt(seats), toUnits(bond), mode],
        value: vrfFunding,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      // Fast-path: get the new circle's row into Postgres immediately instead
      // of waiting for the indexer's next poll — otherwise the creator can
      // land on /circle/:addr before it's indexed. Best-effort; the indexer
      // reconciles the authoritative contribution/seats/bond/mode regardless.
      confirmTransaction(await getAccessToken(), hash, 'createCircle');

      // Recover the new clone address from the CircleCreated event.
      const logs = parseEventLogs({ abi: circleFactoryAbi as any, logs: receipt.logs, eventName: 'CircleCreated' });
      const newAddr = (logs[0] as any)?.args?.circle as string | undefined;
      if (!newAddr) throw new Error('Circle created but address not found in logs');

      // Mint the reusable share link + send any email invites. Best-effort: the
      // circle already exists on-chain, so a failure here must not block success.
      // The indexer may not have the Circle row for a beat, so retry briefly —
      // the creator-only check on the API reads the indexed creator field.
      try {
        const token = await getAccessToken();
        const emails = parseEmails(inviteEmails);
        for (let i = 0; i < 5; i++) {
          try {
            await createInvites(token, newAddr, emails);
            break;
          } catch (inviteErr: any) {
            if (i === 4) throw inviteErr;
            await new Promise(r => setTimeout(r, 1500));
          }
        }
      } catch (inviteErr) {
        console.warn('Invite send failed (non-fatal):', inviteErr);
      }

      onSuccess?.(newAddr);
    } catch (e: any) {
      setError(e?.shortMessage ?? e?.message ?? 'Error creating circle');
    } finally {
      setCreating(false);
    }
  };

  const field = 'w-full px-3 py-2.5 border rounded-sm bg-white text-sm focus:outline-none focus:border-[#c9a15c]';

  return (
    <div className="space-y-5 max-w-md">
      <div>
        <label className="block text-xs font-mono tracking-[0.12em] uppercase text-[#6b6470] mb-2">Draw mode</label>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setMode(0)}
            className={`px-3 py-2.5 rounded-sm border text-sm font-medium transition-colors ${mode === 0 ? 'border-[#0b0b0e] bg-[#0b0b0e] text-[#faf9f6]' : 'border-[#e6e2d9] text-[#6b6470] hover:border-[#0b0b0e]'}`}
          >
            Lucky draw
          </button>
          <button
            type="button"
            onClick={() => setMode(1)}
            className={`px-3 py-2.5 rounded-sm border text-sm font-medium transition-colors ${mode === 1 ? 'border-[#0b0b0e] bg-[#0b0b0e] text-[#faf9f6]' : 'border-[#e6e2d9] text-[#6b6470] hover:border-[#0b0b0e]'}`}
          >
            Auction
          </button>
        </div>
        <p className="text-xs text-[#6b6470] mt-2 leading-relaxed">
          {mode === 0 ? 'A random member is drawn each round via verifiable randomness.' : 'Members bid a discount; the highest bidder wins, and the discount is shared with everyone as a dividend.'}
        </p>
      </div>

      <div>
        <label className="block text-xs font-mono tracking-[0.12em] uppercase text-[#6b6470] mb-2">Seats (2–20)</label>
        <input type="number" min={2} max={20} value={seats}
          onChange={e => setSeats(Number(e.target.value))}
          className={`${field} border-[#e6e2d9]`} />
      </div>

      <div>
        <label className="block text-xs font-mono tracking-[0.12em] uppercase text-[#6b6470] mb-2">Contribution / round (mUSDC)</label>
        <input type="number" min={1} value={contribution}
          onChange={e => setContribution(Number(e.target.value))}
          className={`${field} border-[#e6e2d9]`} />
      </div>

      <div>
        <label className="block text-xs font-mono tracking-[0.12em] uppercase text-[#6b6470] mb-2">
          Bond (mUSDC) · min {minBond}
        </label>
        <input type="number" min={minBond} value={bond}
          onChange={e => setBond(Number(e.target.value))}
          className={`${field} ${bondValid ? 'border-[#e6e2d9]' : 'border-[#c98a7c]'}`} />
        {!bondValid && <p className="text-[#9a4a3a] text-xs mt-1.5">Bond must be at least (seats − 1) × contribution = {minBond}</p>}
      </div>

      <div>
        <label className="block text-xs font-mono tracking-[0.12em] uppercase text-[#6b6470] mb-2">
          Invite by email · optional
        </label>
        <textarea
          value={inviteEmails}
          onChange={e => setInviteEmails(e.target.value)}
          placeholder="alice@example.com, bob@example.com"
          rows={2}
          className={`${field} border-[#e6e2d9] resize-none`}
        />
        <p className="text-xs text-[#6b6470] mt-1.5">
          They&rsquo;ll get an email with a link to join. You can also copy a shareable link after creating.
        </p>
      </div>

      {vrfQuote !== null && vrfQuote > 0n && (
        <div className="text-xs text-[#6b6470] bg-[#f0ead8]/50 border border-[#e6e2d9] rounded-sm px-3 py-2.5 leading-relaxed">
          <span className="font-medium text-[#0b0b0e]">Randomness funding · {formatEther(vrfQuote)} MON</span><br />
          This funds the verifiable-randomness fee for all {seats} draws, so members never need MON to play.
          Anything unused is refunded to you when the circle completes.
          <br />
          <span className="text-[#3a6d4a]">
            Covered for you — we top up the fee automatically, so creating is free.
          </span>
        </div>
      )}

      {error && <p className="text-[#9a4a3a] text-sm bg-[#f3e3e0] border border-[#e8cfc9] rounded-sm px-3 py-2.5">{error}</p>}

      <Button
        onClick={handleCreate}
        disabled={creating || !privyReady || walletResolving || !bondValid || !seatsValid}
        full
      >
        {creating
          ? 'Creating…'
          : !privyReady
            ? 'Loading…'
            : !authenticated
              ? 'Sign in & create'
              : walletResolving
                ? 'Preparing wallet…'
                : 'Create circle'}
      </Button>

      <p className="text-xs text-[#6b6470]">
        Creating is free (just gas). You join and stake your bond as a separate step afterward.
      </p>
    </div>
  );
}
