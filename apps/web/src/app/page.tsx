import Link from 'next/link';
import { WaitlistForm } from '@/components/WaitlistForm';

export default function HomePage() {
  return (
    <main className="min-h-screen bg-white">
      {/* Hero */}
      <section className="max-w-4xl mx-auto px-6 py-20 text-center">
        <h1 className="text-5xl font-bold text-gray-900 mb-4">
          Save together.<br/>
          <span className="text-purple-600">Trust the math, not the person.</span>
        </h1>
        <p className="text-xl text-gray-600 mb-10 max-w-2xl mx-auto">
          Bhishi is a non-custodial savings circle on Monad. No organizer holds your money.
          Payouts are decided by verifiable randomness. If anything stalls, you can always reclaim your funds.
        </p>
        {/* CTAs */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center mb-12">
          <Link href="/demo" className="px-8 py-4 bg-purple-600 text-white rounded-lg text-lg font-semibold hover:bg-purple-700 transition">
            Try Demo Circle
          </Link>
          <Link href="/create" className="px-8 py-4 border-2 border-purple-600 text-purple-600 rounded-lg text-lg font-semibold hover:bg-purple-50 transition">
            Create Your Own
          </Link>
        </div>
        {/* Waitlist */}
        <WaitlistForm />
      </section>

      {/* Four money shots */}
      <section className="bg-gray-50 py-16">
        <div className="max-w-4xl mx-auto px-6 grid grid-cols-1 sm:grid-cols-2 gap-6">
          {[
            { icon: '🔒', title: '✓ CUSTODY', desc: 'The organizer cannot withdraw. Ever. The contract holds your funds.' },
            { icon: '🎲', title: '✓ FAIRNESS', desc: 'Payout order is decided by Gelato VRF — verifiably random, not chosen by anyone.' },
            { icon: '⚡', title: '✓ DEFAULT', desc: 'If someone skips their contribution, their bond covers it automatically.' },
            { icon: '🛡️', title: '✓ LIVENESS', desc: 'If the VRF goes silent, any member can reclaim their funds permissionlessly.' },
          ].map((shot) => (
            <div key={shot.title} className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
              <div className="text-3xl mb-2">{shot.icon}</div>
              <h3 className="text-lg font-bold text-gray-900 mb-1">{shot.title}</h3>
              <p className="text-gray-600 text-sm">{shot.desc}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
