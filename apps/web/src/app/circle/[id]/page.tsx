import { CircleView } from '@/components/CircleView';
export default function CirclePage({ params }: { params: { id: string } }) {
  return (
    <main className="max-w-2xl mx-auto px-6 py-12">
      <h1 className="text-3xl font-bold mb-6">Circle</h1>
      <CircleView address={params.id as `0x${string}`} />
    </main>
  );
}
