import { CircleView } from '@/components/CircleView';
export default async function CirclePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="max-w-2xl mx-auto px-6 py-12">
      <h1 className="text-3xl font-bold mb-6">Circle</h1>
      <CircleView address={id as `0x${string}`} />
    </main>
  );
}
