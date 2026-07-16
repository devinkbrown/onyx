// SPDX-License-Identifier: AGPL-3.0-or-later
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
import type { OnyxState } from '@/lib/store/store';

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

const SESSION_CHANGED_REASON = 'Your account or connection changed. Try again.';

function pushSessionCurrent(account: string, client: NonNullable<OnyxState['client']>): boolean {
  const state = getState();
  return state.connectionStatus === 'connected' && state.client === client && selectAccount(state) === account;
}

async function discardCreatedSubscription(subscription: PushSubscription | null): Promise<void> {
  if (!subscription) return;
  try {
    await subscription.unsubscribe();
  } catch {
    // It was never registered with the server; best-effort local cleanup is
    // safer than sending it on a replacement account or client session.
  }
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
  const initialState = getState();
  const account = selectAccount(initialState);
  if (!account) return { ok: false, reason: 'Sign in first — push is tied to your account.' };
  if (initialState.connectionStatus !== 'connected' || !initialState.client) {
    return { ok: false, reason: 'Reconnect first.' };
  }
  const client = initialState.client;
  const key = client.isupport.VAPID ?? '';
  if (!key) return { ok: false, reason: 'Push is not enabled on this server.' };

  let permission: NotificationPermission;
  try {
    permission = await Notification.requestPermission();
  } catch {
    return { ok: false, reason: 'Requesting notification permission failed.' };
  }
  if (permission !== 'granted') return { ok: false, reason: 'Notifications are blocked by the browser.' };
  if (!pushSessionCurrent(account, client)) return { ok: false, reason: SESSION_CHANGED_REASON };

  let createdSubscription: PushSubscription | null = null;
  try {
    const reg = await navigator.serviceWorker.ready;
    if (!pushSessionCurrent(account, client)) return { ok: false, reason: SESSION_CHANGED_REASON };

    let sub = await reg.pushManager.getSubscription();
    if (!pushSessionCurrent(account, client)) return { ok: false, reason: SESSION_CHANGED_REASON };
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: vapidKeyToBytes(key).buffer as ArrayBuffer,
      });
      createdSubscription = sub;
    }
    if (!pushSessionCurrent(account, client)) {
      await discardCreatedSubscription(createdSubscription);
      return { ok: false, reason: SESSION_CHANGED_REASON };
    }

    const json = sub.toJSON();
    const p256dh = json.keys?.p256dh;
    const auth = json.keys?.auth;
    if (!sub.endpoint || !p256dh || !auth) {
      await discardCreatedSubscription(createdSubscription);
      return { ok: false, reason: 'The browser returned an incomplete subscription.' };
    }
    client.sendRaw('WEBPUSH', 'SUBSCRIBE', sub.endpoint, p256dh, auth);
    return { ok: true };
  } catch {
    await discardCreatedSubscription(createdSubscription);
    return { ok: false, reason: 'Subscribing failed — check site notification settings.' };
  }
}

/** Drop this browser's subscription locally and on the server. */
export async function disableWebPush(): Promise<WebPushResult> {
  if (!webPushSupported()) return { ok: false, reason: 'This browser does not support push.' };
  const initialState = getState();
  const account = selectAccount(initialState);
  const client = initialState.client;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return { ok: true };

    if (!await sub.unsubscribe()) {
      return { ok: false, reason: 'The browser could not remove its push subscription.' };
    }

    // Never unregister an endpoint through a replacement account/session.
    // Local unsubscribe remains safe and makes the browser truthfully off.
    if (account && client && pushSessionCurrent(account, client)) {
      try {
        client.sendRaw('WEBPUSH', 'UNSUBSCRIBE', sub.endpoint);
      } catch {
        // The local subscription is already revoked, so this browser is off.
      }
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: 'Turning off push failed. Try again.' };
  }
}
