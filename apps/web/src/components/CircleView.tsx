/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';
import { useEffect, useState } from 'react';
import { createPublicClient, http } from 'viem';
import { monadTestnetChain } from '@/lib/privy';
import { circleAbi } from '@/lib/contracts';
import { PhaseBadge } from './PhaseBadge';
import { EventFeed } from './EventFeed';

const STATE_NAMES = ['FILLING','ACTIVE','ABORTED','COMMIT','REVEAL','DRAW','PAYOUT','COMPLETED','STALLED'] as const;

export function CircleView({ address }: { address: `0x${string}` }) {
  const [state, setState] = useState<number | null>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const client = createPublicClient({ chain: monadTestnetChain, transport: http() });
    async function load() {
      try {
        const stateVal = await client.readContract({ address, abi: circleAbi as any, functionName: 'state' });
        setState(Number(stateVal));
        // Load events dynamically to avoid SSR issues
        try {
          const { getCircleEvents } = await import('@bhishi/events');
          const evts = await getCircleEvents(client as any, address);
          setEvents(evts as any[]);
        } catch {
          // events package may not be available yet
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [address]);

  if (loading) return <div className="animate-pulse text-gray-400">Loading circle...</div>;
  const phaseName = state !== null ? (STATE_NAMES[state] ?? 'UNKNOWN') : 'UNKNOWN';

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <span className="font-mono text-sm text-gray-500 truncate">{address}</span>
        <PhaseBadge phase={phaseName as any} />
      </div>
      <div>
        <h3 className="font-semibold text-gray-700 mb-2">Audit Trail</h3>
        <EventFeed events={events} />
      </div>
    </div>
  );
}
