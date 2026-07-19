'use client';
import { useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useRouter } from 'next/navigation';
import { apiUrl } from '@/lib/api';

const TRADITIONS = [
  'Bhishi',
  'Chit Fund',
  'Kitty Party',
  'Committee (BC)',
  'ROSCA',
  'Susu',
  'Tanda',
  'Other / our own tradition',
];

type Status = 'idle' | 'loading' | 'done' | 'dismissed' | 'error';

export default function EarlyAccessPage() {
  const { ready, authenticated, login, user, getAccessToken } = usePrivy();
  const router = useRouter();
  const email = user?.email?.address ?? '';

  const [name, setName] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [tradition, setTradition] = useState('');
  const [circleSize, setCircleSize] = useState('');
  const [trackingMethod, setTrackingMethod] = useState('');
  const [role, setRole] = useState<'member' | 'organiser' | ''>('');
  const [location, setLocation] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<Status>('idle');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('loading');
    try {
      // If signed in, attach the Privy token so the API can bind the verified
      // wallet to the entry (server-side, never from the body). Anonymous is fine
      // too — the endpoint uses an OptionalPrivyAuthGuard.
      const token = authenticated ? await getAccessToken().catch(() => null) : null;
      // Only send whitelisted DTO fields; the API rejects unknown ones. Empty
      // optionals are dropped so class-validator doesn't choke on ''.
      const body: Record<string, unknown> = { email, name };
      if (whatsapp) body.whatsapp = whatsapp;
      if (tradition) body.tradition = tradition;
      if (circleSize) body.circleSize = circleSize;
      if (trackingMethod) body.trackingMethod = trackingMethod;
      if (role) body.role = role;
      if (location) body.location = location;
      if (message) body.message = message;

      const res = await fetch(apiUrl('/api/waitlist'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });
      setStatus(res.ok ? 'done' : 'error');
    } catch {
      setStatus('error');
    }
  };

  if (!ready) {
    return (
      <main className="min-h-[70vh] flex items-center justify-center bg-[#faf9f6]">
        <div className="w-24 h-9 bg-black/5 animate-pulse" />
      </main>
    );
  }

  if (!authenticated) {
    return (
      <main className="min-h-[70vh] flex items-center justify-center bg-[#faf9f6] px-6">
        <div className="max-w-sm text-center">
          <h1 className="font-display font-semibold text-2xl text-[#0b0b0e] mb-3">
            Sign in to continue
          </h1>
          <p className="text-[#6b6470] mb-6">
            We verify your email so we can reach you when your circle opens.
          </p>
          <button
            type="button"
            onClick={() => login()}
            className="bg-[#0b0b0e] text-white font-semibold px-8 py-3.5 hover:bg-[#232127] transition"
          >
            Sign in
          </button>
        </div>
      </main>
    );
  }

  if (status === 'done') {
    return (
      <main className="min-h-[70vh] flex items-center justify-center bg-[#faf9f6] px-6">
        <div className="max-w-sm text-center">
          <h1 className="font-display font-semibold text-2xl text-[#0b0b0e] mb-3">
            You&apos;re on the list
          </h1>
          <p className="text-[#6b6470] mb-8">
            We&apos;ll reach out on WhatsApp when a circle matching yours opens.
          </p>
          <p className="text-sm text-[#6b6470] mb-4">Want to try Bhishi right now?</p>
          <div className="flex gap-3 justify-center">
            <button
              type="button"
              onClick={() => router.push('/dashboard')}
              className="bg-[#0b0b0e] text-white font-semibold px-8 py-3.5 hover:bg-[#232127] transition"
            >
              Yes, take me there
            </button>
            <button
              type="button"
              onClick={() => setStatus('dismissed')}
              className="border border-black/15 text-[#0b0b0e] font-semibold px-8 py-3.5 hover:bg-black/5 transition"
            >
              No thanks
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (status === 'dismissed') {
    return (
      <main className="min-h-[70vh] flex items-center justify-center bg-[#faf9f6] px-6">
        <div className="max-w-sm text-center">
          <span className="inline-flex items-center gap-2 bg-[#e6efe8] border border-[#cfe0d3] text-[#3a6d4a] text-xs font-semibold uppercase tracking-[0.1em] px-3 py-1.5 mb-5">
            ✓ You&apos;re on the list
          </span>
          <h1 className="font-display font-semibold text-2xl text-[#0b0b0e] mb-3">
            All set — see you soon
          </h1>
          <p className="text-[#6b6470]">
            We&apos;ll reach out on WhatsApp when a circle matching yours opens.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-[70vh] bg-[#faf9f6] py-16 px-6">
      <form onSubmit={submit} className="max-w-lg mx-auto bg-white border border-black/10 p-8">
        <p className="font-mono text-xs tracking-[0.2em] uppercase text-[#c9a15c] mb-3">
          Get early access
        </p>
        <h1 className="font-display font-semibold text-2xl text-[#0b0b0e] mb-8">
          Tell us about your circle
        </h1>

        <div className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-[#0b0b0e] mb-1.5">Name</label>
            <input
              type="text"
              required
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-4 py-2.5 border border-black/15 focus:outline-none focus:ring-2 focus:ring-[#c9a15c]"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[#0b0b0e] mb-1.5">Email</label>
            <input
              type="email"
              value={email}
              readOnly
              className="w-full px-4 py-2.5 border border-black/15 bg-black/5 text-[#6b6470]"
            />
            <p className="text-xs text-[#6b6470] mt-1">Verified via sign-in</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-[#0b0b0e] mb-1.5">WhatsApp number</label>
            <input
              type="tel"
              required
              value={whatsapp}
              onChange={e => setWhatsapp(e.target.value)}
              placeholder="+91 98765 43210"
              className="w-full px-4 py-2.5 border border-black/15 focus:outline-none focus:ring-2 focus:ring-[#c9a15c]"
            />
          </div>

          <div className="pt-4 border-t border-black/10">
            <p className="text-sm font-semibold text-[#0b0b0e] mb-4">Your circle</p>

            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-[#0b0b0e] mb-1.5">
                  Which tradition is closest to yours?
                </label>
                <select
                  required
                  value={tradition}
                  onChange={e => setTradition(e.target.value)}
                  className="w-full px-4 py-2.5 border border-black/15 bg-white focus:outline-none focus:ring-2 focus:ring-[#c9a15c]"
                >
                  <option value="" disabled>Please choose...</option>
                  {TRADITIONS.map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-[#0b0b0e] mb-1.5">
                  How many people are in your circle?
                </label>
                <input
                  type="number"
                  min={1}
                  required
                  value={circleSize}
                  onChange={e => setCircleSize(e.target.value)}
                  className="w-full px-4 py-2.5 border border-black/15 focus:outline-none focus:ring-2 focus:ring-[#c9a15c]"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[#0b0b0e] mb-1.5">
                  How do you keep track today?
                </label>
                <input
                  type="text"
                  required
                  value={trackingMethod}
                  onChange={e => setTrackingMethod(e.target.value)}
                  placeholder="e.g. a notebook, a WhatsApp group, a spreadsheet"
                  className="w-full px-4 py-2.5 border border-black/15 focus:outline-none focus:ring-2 focus:ring-[#c9a15c]"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[#0b0b0e] mb-2">
                  What&apos;s your role in the circle?
                </label>
                <div className="flex gap-6">
                  {(['member', 'organiser'] as const).map(r => (
                    <label key={r} className="flex items-center gap-2 text-sm text-[#0b0b0e] cursor-pointer">
                      <input
                        type="radio"
                        name="role"
                        required
                        checked={role === r}
                        onChange={() => setRole(r)}
                        className="accent-[#c9a15c]"
                      />
                      {r === 'member' ? 'Member' : 'Organiser'}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-black/10">
            <p className="text-sm font-semibold text-[#0b0b0e] mb-4">Join the community wall</p>
            <p className="text-xs text-[#6b6470] -mt-3 mb-4">
              Optional — share where you&apos;re from and what you think of Bhishi, and your card
              joins the wall on our landing page.
            </p>

            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-[#0b0b0e] mb-1.5">City</label>
                <input
                  type="text"
                  value={location}
                  onChange={e => setLocation(e.target.value)}
                  placeholder="e.g. Chennai, Mumbai, Bengaluru"
                  className="w-full px-4 py-2.5 border border-black/15 focus:outline-none focus:ring-2 focus:ring-[#c9a15c]"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[#0b0b0e] mb-1.5">
                  What do you feel about our platform?
                </label>
                <textarea
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  maxLength={400}
                  rows={3}
                  placeholder="Tell us what stands out, or what you're hoping to use it for"
                  className="w-full px-4 py-2.5 border border-black/15 focus:outline-none focus:ring-2 focus:ring-[#c9a15c] resize-none"
                />
              </div>
            </div>
          </div>

          {status === 'error' && (
            <p className="text-sm text-red-600">Something went wrong. Please try again.</p>
          )}

          <button
            type="submit"
            disabled={status === 'loading'}
            className="w-full bg-[#0b0b0e] text-white font-semibold px-8 py-3.5 hover:bg-[#232127] transition disabled:opacity-50"
          >
            {status === 'loading' ? 'Submitting...' : 'Join the waitlist'}
          </button>
        </div>
      </form>
    </main>
  );
}
