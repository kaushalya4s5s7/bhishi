'use client';
import { CreateWizard } from '@/components/CreateWizard';
import { AuthGate } from '@/components/AuthGate';
import { Card, Eyebrow } from '@/components/ui';
import { useRouter } from 'next/navigation';

export default function CreatePage() {
  const router = useRouter();
  return (
    <main className="max-w-lg mx-auto px-4 sm:px-6 py-14 sm:py-20">
      <AuthGate
        title="Sign in to start a circle"
        blurb="You'll create and fund the circle. Signing in sets up your wallet."
      >
        <div className="mb-8">
          <Eyebrow>New circle</Eyebrow>
          <h1 className="font-display font-semibold text-4xl mt-3 leading-none">Start a circle</h1>
        </div>
        <Card className="p-7">
          <CreateWizard onSuccess={(addr) => router.push(`/circle/${addr}`)} />
        </Card>
      </AuthGate>
    </main>
  );
}
