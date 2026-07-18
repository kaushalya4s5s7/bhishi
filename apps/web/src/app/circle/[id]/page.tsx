import { CircleView } from '@/components/CircleView';

export default async function CirclePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ invite?: string }>;
}) {
  const { id } = await params;
  const { invite } = await searchParams;
  // key={id} forces a fresh CircleView instance (fresh initial state) on every
  // navigation between different circles — without it, Next.js reuses the
  // same component instance across client-side route changes, so the
  // previous circle's stale on-chain data briefly renders under the new URL
  // until load() catches up.
  return <CircleView key={id} circleAddress={id as `0x${string}`} inviteToken={invite} />;
}
