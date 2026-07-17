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
  return <CircleView circleAddress={id as `0x${string}`} inviteToken={invite} />;
}
