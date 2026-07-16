/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';
import { useState } from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { parseEventLogs } from 'viem';
import { addresses, circleFactoryAbi } from '@/lib/contracts';
import { publicClient, getWalletClient } from '@/lib/wallet';

interface CreateWizardProps {
  onSuccess?: (addr: string) => void;
}

// mUSDC has 6 decimals; UI inputs are whole mUSDC units.
const toUnits = (n: number) => BigInt(Math.round(n * 1e6));

type Mode = 0 | 1; // 0 = LUCKY_DRAW, 1 = AUCTION

export function CreateWizard({ onSuccess }: CreateWizardProps = {}) {
  const { authenticated, login } = usePrivy();
  const { wallets } = useWallets();
  const embeddedWallet = wallets.find(w => w.walletClientType === 'privy');
  const userAddress = embeddedWallet?.address as `0x${string}` | undefined;

  const [seats, setSeats] = useState(4);
  const [contribution, setContribution] = useState(100);
  const [bond, setBond] = useState(300);
  const [mode, setMode] = useState<Mode>(0);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

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
      const wc = await getWalletClient(embeddedWallet, userAddress);
      const hash = await wc.writeContract({
        address: addresses.monadTestnet.factory,
        abi: circleFactoryAbi as any,
        functionName: 'createCircle',
        args: [toUnits(contribution), BigInt(seats), toUnits(bond), mode],
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

  return (
    <div className="space-y-6 max-w-md">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Draw mode</label>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setMode(0)}
            className={`px-3 py-2 rounded-lg border text-sm font-medium transition ${mode === 0 ? 'border-purple-500 bg-purple-50 text-purple-700' : 'border-gray-300 text-gray-600'}`}
          >
            Lucky draw
          </button>
          <button
            type="button"
            onClick={() => setMode(1)}
            className={`px-3 py-2 rounded-lg border text-sm font-medium transition ${mode === 1 ? 'border-purple-500 bg-purple-50 text-purple-700' : 'border-gray-300 text-gray-600'}`}
          >
            Auction
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          {mode === 0 ? 'Winner each round is picked at random.' : 'Members bid a discount; highest bidder wins, discount shared as dividend.'}
        </p>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Number of seats (2–20)</label>
        <input type="number" min={2} max={20} value={seats}
          onChange={e => setSeats(Number(e.target.value))}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500" />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Contribution per round (mUSDC)</label>
        <input type="number" min={1} value={contribution}
          onChange={e => setContribution(Number(e.target.value))}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500" />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Bond (mUSDC) — minimum: {minBond}
        </label>
        <input type="number" min={minBond} value={bond}
          onChange={e => setBond(Number(e.target.value))}
          className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 ${bondValid ? 'border-gray-300' : 'border-red-400'}`} />
        {!bondValid && <p className="text-red-500 text-sm mt-1">Bond must be ≥ (seats−1) × contribution = {minBond}</p>}
      </div>
      {error && <p className="text-red-500 text-sm">{error}</p>}
      <button onClick={handleCreate} disabled={creating || !bondValid || !seatsValid}
        className="w-full py-3 bg-purple-600 text-white rounded-lg font-semibold hover:bg-purple-700 transition disabled:opacity-50">
        {creating ? 'Creating...' : authenticated ? 'Create Circle' : 'Login & Create'}
      </button>
      <p className="text-xs text-gray-400">
        Creating a circle is free (just gas). You join and stake your bond as a separate step afterward.
      </p>
    </div>
  );
}
