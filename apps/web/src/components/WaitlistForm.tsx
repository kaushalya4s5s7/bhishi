'use client';
import { useState } from 'react';
export function WaitlistForm() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle'|'loading'|'done'|'error'>('idle');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('loading');
    const res = await fetch('/api/waitlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
    setStatus(res.ok ? 'done' : 'error');
  };
  if (status === 'done') return <p className="text-green-600 font-medium">You&apos;re on the list! ₹ off-ramp coming soon.</p>;
  return (
    <form onSubmit={submit} className="flex gap-2 max-w-md mx-auto">
      <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="your@email.com" required
        className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500" />
      <button type="submit" disabled={status==='loading'} className="px-6 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-700 transition disabled:opacity-50">
        {status === 'loading' ? '...' : 'Join Waitlist'}
      </button>
    </form>
  );
}
