/**
 * webPush.ts — browser Web Push subscription against Orochi's WEBPUSH command
 * (Roadmap Phase 2.4: reach you with the tab closed).
 *
 * Flow: read the server's VAPID public key from ISUPPORT (`VAPID=`, no
 * round-trip), subscribe through the service worker's PushManager, then hand
 * the endpoint + keys to the server (`WEBPUSH SUBSCRIBE`). The server pushes an RFC 8291
 * end-to-end-encrypted payload when a DM lands while no session is attached;
 * the service worker renders it. Account-scoped: guests can't subscribe.
 */
import { getState, selectAccount } from '@/lib/store';

export type WebPushResult =
  | { ok: true }
  | { ok: false; reason: string };

/** base64url → the BufferSource pushManager.subscribe expects. */
export function vapidKeyToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function webPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** The server's VAPID key, advertised in ISUPPORT (`VAPID=`). No round-trip. */
function vapidKey(): string | null {
  const key = getState().client?.isupport.VAPID ?? '';
  return key.length > 0 ? key : null;
}

/** True when this browser holds a live push subscription. */
export async function webPushActive(): Promise<boolean> {
  if (!webPushSupported()) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    return (await reg.pushManager.getSubscription()) !== null;
  } catch {
    return false;
  }
}

/** Subscribe this browser and register it with the server. */
export async function enableWebPush(): Promise<WebPushResult> {
  if (!webPushSupported()) return { ok: false, reason: 'This browser does not support push.' };
  if (!selectAccount(getState())) return { ok: false, reason: 'Sign in first — push is tied to your account.' };
  if (getState().connectionStatus !== 'connected') return { ok: false, reason: 'Reconnect first.' };

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, reason: 'Notifications are blocked by the browser.' };

  const key = vapidKey();
  if (!key) return { ok: false, reason: 'Push is not enabled on this server.' };

  try {
    const reg = await navigator.serviceWorker.ready;
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: vapidKeyToBytes(key).buffer as ArrayBuffer,
      }));
    const json = sub.toJSON();
    const p256dh = json.keys?.p256dh;
    const auth = json.keys?.auth;
    if (!sub.endpoint || !p256dh || !auth) {
      return { ok: false, reason: 'The browser returned an incomplete subscription.' };
    }
    getState().client?.sendRaw('WEBPUSH', 'SUBSCRIBE', sub.endpoint, p256dh, auth);
    return { ok: true };
  } catch {
    return { ok: false, reason: 'Subscribing failed — check site notification settings.' };
  }
}

/** Drop this browser's subscription locally and on the server. */
export async function disableWebPush(): Promise<void> {
  if (!webPushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    getState().client?.sendRaw('WEBPUSH', 'UNSUBSCRIBE', sub.endpoint);
    await sub.unsubscribe();
  } catch {
    /* best-effort */
  }
}
