/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';
import { useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { formatEther, parseEventLogs } from 'viem';
import { addresses, circleFactoryAbi } from '@/lib/contracts';
import { publicClient } from '@/lib/wallet';
import { useMember } from '@/lib/member';
import { Button } from '@/components/ui';

interface CreateWizardProps {
  onSuccess?: (addr: string) => void;
}

// mUSDC has 6 decimals; UI inputs are whole mUSDC units.
const toUnits = (n: number) => BigInt(Math.round(n * 1e6));

type Mode = 0 | 1; // 0 = LUCKY_DRAW, 1 = AUCTION

export function CreateWizard({ onSuccess }: CreateWizardProps = {}) {
  const { authenticated, login } = usePrivy();
  // The creator identity matters beyond signing: the circle refunds leftover VRF
  // funding to createCircle's caller, so this must be the address the user
  // actually controls funds with (see lib/member.ts).
  const { address: userAddress, write } = useMember();

  const [seats, setSeats] = useState(4);
  const [contribution, setContribution] = useState(100);
  const [bond, setBond] = useState(300);
  const [mode, setMode] = useState<Mode>(0);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [vrfQuote, setVrfQuote] = useState<bigint | null>(null);

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
    if (!authenticated || !userAddress) { await login(); return; }
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

      const hash = await write({
        address: addresses.monadTestnet.factory,
        abi: circleFactoryAbi as any,
        functionName: 'createCircle',
        args: [toUnits(contribution), BigInt(seats), toUnits(bond), mode],
        value: vrfFunding,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      // Recover the new clone address from the CircleCreated event.
      const logs = parseEventLogs({ abi: circleFactoryAbi as any, logs: receipt.logs, eventName: 'CircleCreated' });
      const newAddr = (logs[0] as any)?.args?.circle as string | undefined;
      if (!newAddr) throw new Error('Circle created but address not found in logs');

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

      {vrfQuote !== null && vrfQuote > 0n && (
        <div className="text-xs text-[#6b6470] bg-[#f0ead8]/50 border border-[#e6e2d9] rounded-sm px-3 py-2.5 leading-relaxed">
          <span className="font-medium text-[#0b0b0e]">Randomness funding · {formatEther(vrfQuote)} MON</span><br />
          You pre-pay the verifiable-randomness fee for all {seats} draws, so members never need MON to play.
          Anything unused is refunded to you when the circle completes.
        </div>
      )}

      {error && <p className="text-[#9a4a3a] text-sm bg-[#f3e3e0] border border-[#e8cfc9] rounded-sm px-3 py-2.5">{error}</p>}

      <Button onClick={handleCreate} disabled={creating || !bondValid || !seatsValid} full>
        {creating ? 'Creating…' : authenticated ? 'Create circle' : 'Sign in & create'}
      </Button>

      <p className="text-xs text-[#6b6470]">
        Creating is free (just gas). You join and stake your bond as a separate step afterward.
      </p>
    </div>
  );
}
