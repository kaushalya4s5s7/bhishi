'use client';
type Phase = 'FILLING' | 'COMMIT' | 'REVEAL' | 'DRAW' | 'COMPLETED' | 'STALLED' | 'ABORTED';
const colors: Record<Phase, string> = {
  FILLING: 'bg-blue-100 text-blue-800',
  COMMIT: 'bg-yellow-100 text-yellow-800',
  REVEAL: 'bg-orange-100 text-orange-800',
  DRAW: 'bg-purple-100 text-purple-800',
  COMPLETED: 'bg-green-100 text-green-800',
  STALLED: 'bg-red-100 text-red-800',
  ABORTED: 'bg-gray-100 text-gray-800',
};
export function PhaseBadge({ phase }: { phase: Phase }) {
  return (
    <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${colors[phase] ?? 'bg-gray-100 text-gray-800'}`}>
      {phase}
    </span>
  );
}
