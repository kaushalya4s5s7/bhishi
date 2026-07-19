import { apiUrl } from './api';

const VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function pushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && Boolean(VAPID);
}

/** Outcome of an enablePush() attempt. The caller uses this to give the user
 *  a specific, actionable message instead of silently reverting the button. */
export type EnablePushResult =
  | 'enabled'       // subscribed and persisted — done
  | 'unsupported'   // this browser can't do web push (or VAPID missing)
  | 'denied'        // user blocked notifications (needs browser settings to undo)
  | 'dismissed'     // user closed the prompt without choosing — retry is fine
  | 'error';        // subscribe/network/API failure — retry is fine

/** Ask permission, subscribe via the active SW, and persist to the API.
 *  Returns a structured outcome so the UI can explain what happened.
 *  Safe to call repeatedly. */
export async function enablePush(token: string | null): Promise<EnablePushResult> {
  if (!pushSupported()) return 'unsupported';
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      // 'denied' = actively blocked (sticky; only browser settings can undo).
      // 'default' = the user dismissed the prompt without choosing — retryable.
      return perm === 'denied' ? 'denied' : 'dismissed';
    }

    const reg = await navigator.serviceWorker.ready;
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID) as BufferSource,
      }));

    const json = sub.toJSON();
    const res = await fetch(apiUrl('/api/push/subscribe'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ endpoint: sub.endpoint, p256dh: json.keys!.p256dh, auth: json.keys!.auth }),
    });
    return res.ok ? 'enabled' : 'error';
  } catch {
    // Subscribe/network failure is non-fatal — surface it so the user can retry.
    return 'error';
  }
}
