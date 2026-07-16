import { CreateWizard } from '@/components/CreateWizard';
export default function CreatePage() {
  return (
    <main className="max-w-2xl mx-auto px-6 py-12">
      <h1 className="text-3xl font-bold mb-2">Create a Circle</h1>
      <p className="text-gray-600 mb-8">Set up your savings group. The bond gate is enforced both here and on-chain.</p>
      <CreateWizard />
    </main>
  );
}
