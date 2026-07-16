'use client';
type Event = { name: string; blockNumber: bigint; transactionHash: string; args: Record<string, unknown> };
export function EventFeed({ events }: { events: Event[] }) {
  if (events.length === 0) return <p className="text-gray-500 text-sm">No events yet.</p>;
  return (
    <ul className="space-y-2">
      {events.map((e, i) => (
        <li key={i} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg text-sm">
          <span className="font-mono text-purple-600 shrink-0">#{String(e.blockNumber)}</span>
          <div>
            <span className="font-semibold">{e.name}</span>
            {Object.keys(e.args).length > 0 && (
              <span className="text-gray-500 ml-2">{JSON.stringify(e.args, (_, v) => typeof v === 'bigint' ? v.toString() : v)}</span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
