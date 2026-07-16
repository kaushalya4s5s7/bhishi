/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';
import { useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';

export function CreateWizard() {
  const { authenticated, login } = usePrivy();
  const [seats, setSeats] = useState(4);
  const [contribution, setContribution] = useState(100);
  const [bond, setBond] = useState(300);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  // Mirror on-chain bond gate: bond >= (seats-1) * contribution
  const minBond = (seats - 1) * contribution;
  const bondValid = bond >= minBond;

  const handleCreate = async () => {
    if (!authenticated) { await login(); return; }
    if (!bondValid) { setError(`Bond must be at least ${minBond} mUSDC`); return; }
    setCreating(true);
    setError('');
    try {
      // TODO M11: wire writeContract to CircleFactory.createCircle
      alert('Circle creation will be wired in M11 deploy step. Params: seats=' + seats + ' contribution=' + contribution + ' bond=' + bond);
    } catch (e: any) {
      setError(e?.message ?? 'Error creating circle');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6 max-w-md">
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
      <button onClick={handleCreate} disabled={creating || !bondValid}
        className="w-full py-3 bg-purple-600 text-white rounded-lg font-semibold hover:bg-purple-700 transition disabled:opacity-50">
        {creating ? 'Creating...' : authenticated ? 'Create Circle' : 'Login & Create'}
      </button>
    </div>
  );
}
