'use client';
import { AuthGate } from '@/components/AuthGate';
import { Faucet } from '@/components/Faucet';
import { Eyebrow } from '@/components/ui';

const STEPS = [
  { label: 'Claim', detail: '500 mUSDC lands in your wallet instantly' },
  { label: 'Join or start', detail: 'Use it to join a circle or fund your own' },
  { label: 'Reclaim daily', detail: 'Come back every 24 hours for more' },
];

export default function FaucetPage() {
  return (
    <main className="max-w-lg mx-auto px-6 pt-8 sm:pt-10 pb-14">
      <AuthGate
        title="Sign in to get test funds"
        blurb="You'll need a wallet to receive test mUSDC. Signing in creates one for you."
      >
        <div className="mb-8">
          <Eyebrow>Monad testnet</Eyebrow>
          <h1 className="font-display font-semibold text-4xl mt-3 leading-none">Faucet</h1>
        </div>
        <Faucet variant="card" />

        <div className="mt-6 rounded-2xl bg-white shadow-sm p-6">
          <p className="text-xs font-mono tracking-[0.12em] uppercase text-[#6b6470] mb-4">How it works</p>
          <div className="space-y-4">
            {STEPS.map((s, i) => (
              <div key={s.label} className="flex items-start gap-3">
                <span className="w-7 h-7 rounded-full bg-[#f6e9d2] text-[#8a6d2f] text-xs font-semibold grid place-items-center shrink-0">
                  {i + 1}
                </span>
                <div>
                  <p className="text-sm font-medium text-[#0b0b0e]">{s.label}</p>
                  <p className="text-xs text-[#6b6470] mt-0.5">{s.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </AuthGate>
    </main>
  );
}
