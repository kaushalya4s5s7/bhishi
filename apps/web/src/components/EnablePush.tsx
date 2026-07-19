'use client';
import { useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { enablePush, pushSupported } from '@/lib/push';

export function EnablePush() {
  const { authenticated, getAccessToken } = usePrivy();
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setShow(pushSupported() && authenticated && Notification.permission === 'default');
  }, [authenticated]);

  if (!show) return null;

  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const ok = await enablePush(await getAccessToken().catch(() => null));
        setBusy(false);
        if (ok) setShow(false);
      }}
      className="text-xs text-[#c9a15c] border-b border-[#c9a15c] pb-px hover:opacity-70 disabled:opacity-40"
    >
      {busy ? 'Enabling…' : 'Turn on round reminders →'}
    </button>
  );
}
