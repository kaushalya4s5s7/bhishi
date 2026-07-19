'use client';
import { useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { enablePush, pushSupported, type EnablePushResult } from '@/lib/push';

export function EnablePush() {
  const { authenticated, getAccessToken } = usePrivy();
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  // Last non-success outcome, so the user learns WHY the button reverted
  // instead of it silently snapping back to the original label.
  const [note, setNote] = useState<Exclude<EnablePushResult, 'enabled'> | null>(null);

  useEffect(() => {
    setShow(pushSupported() && authenticated && Notification.permission === 'default');
  }, [authenticated]);

  if (!show) return null;

  // 'denied' is sticky (only browser settings can undo it), so once we hit it
  // there's no point offering a retry button — show guidance instead.
  if (note === 'denied') {
    return (
      <p className="text-xs text-[#9a4a3a]">
        Notifications are blocked. Enable them for this site in your browser settings, then reload to turn on round reminders.
      </p>
    );
  }

  const messageFor: Record<Exclude<EnablePushResult, 'enabled' | 'denied'>, string> = {
    dismissed: 'Reminder prompt dismissed — tap again to allow.',
    unsupported: 'This browser can’t do push reminders.',
    error: 'Couldn’t enable reminders — please try again.',
  };

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setNote(null);
          try {
            const result = await enablePush(await getAccessToken().catch(() => null));
            if (result === 'enabled') {
              setShow(false);
            } else {
              // Keep the button visible and tell the user what happened. For
              // retryable outcomes (dismissed/error) they can just click again.
              setNote(result);
            }
          } finally {
            setBusy(false);
          }
        }}
        className="text-xs text-[#c9a15c] border-b border-[#c9a15c] pb-px hover:opacity-70 disabled:opacity-40 self-start"
      >
        {busy ? 'Enabling…' : 'Turn on round reminders →'}
      </button>
      {note && (
        <span className="text-[11px] text-[#9a4a3a]">{messageFor[note]}</span>
      )}
    </div>
  );
}
