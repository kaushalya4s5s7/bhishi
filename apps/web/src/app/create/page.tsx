'use client';
import { CreateWizard } from '@/components/CreateWizard';
import { useRouter } from 'next/navigation';

export default function CreatePage() {
  const router = useRouter();
  return (
    <main className="max-w-lg mx-auto px-6 py-16">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Create a circle</h1>
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8">
        <CreateWizard onSuccess={(addr) => router.push(`/circle/${addr}`)} />
      </div>
    </main>
  );
}
