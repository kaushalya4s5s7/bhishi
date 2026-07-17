'use client';
import { AuthGate } from '@/components/AuthGate';
import { Faucet } from '@/components/Faucet';
import { Eyebrow } from '@/components/ui';

export default function FaucetPage() {
  return (
    <main className="max-w-lg mx-auto px-6 py-14 sm:py-20">
      <AuthGate
        title="Sign in to get test funds"
        blurb="You'll need a wallet to receive test mUSDC. Signing in creates one for you."
      >
        <div className="mb-8">
          <Eyebrow>Monad testnet</Eyebrow>
          <h1 className="font-display font-semibold text-4xl mt-3 leading-none">Faucet</h1>
        </div>
        <Faucet variant="card" />
      </AuthGate>
    </main>
  );
}
