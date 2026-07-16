import { CircleView } from '@/components/CircleView';
export default async function CirclePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CircleView circleAddress={id as `0x${string}`} />;
}
