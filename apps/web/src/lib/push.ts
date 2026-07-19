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

/** Ask permission, subscribe via the active SW, and persist to the API.
 *  Returns true on success. Safe to call repeatedly. */
export async function enablePush(token: string | null): Promise<boolean> {
  if (!pushSupported()) return false;
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return false;

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
  return res.ok;
}
