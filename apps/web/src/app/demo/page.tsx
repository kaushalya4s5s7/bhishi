import { CircleView } from '@/components/CircleView';

export default function DemoPage() {
  const demoCircle = (process.env.NEXT_PUBLIC_DEMO_CIRCLE_ADDRESS ?? '0x0000000000000000000000000000000000000000') as `0x${string}`;
  return (
    <main className="max-w-2xl mx-auto px-6 py-12">
      <h1 className="text-3xl font-bold mb-2">Demo Circle</h1>
      <p className="text-gray-600 mb-8">Watch a live Bhishi savings circle in action on Monad testnet.</p>
      <CircleView address={demoCircle} />
    </main>
  );
}
