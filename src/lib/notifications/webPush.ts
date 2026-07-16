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
import { deviceMemoryOwnerKey } from '@/lib/deviceMemoryOwner';
import { getState, selectAccount, selectDeviceMemoryOwner } from '@/lib/store';
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
export const WEB_PUSH_OWNER_STORAGE_KEY = 'onyx:web-push-owner';

function signedInPushOwnerKey(state: OnyxState): string | null {
  if (!selectAccount(state)) return null;
  const owner = selectDeviceMemoryOwner(state);
  return owner ? deviceMemoryOwnerKey(owner) : null;
}

function readPushOwnerKey(): string | null {
  try {
    const value = localStorage.getItem(WEB_PUSH_OWNER_STORAGE_KEY);
    return value && value.length <= 4_096 ? value : null;
  } catch {
    return null;
  }
}

function savePushOwnerKey(ownerKey: string): boolean {
  try {
    localStorage.setItem(WEB_PUSH_OWNER_STORAGE_KEY, ownerKey);
    return true;
  } catch {
    return false;
  }
}

function clearPushOwnerKey(expectedOwnerKey?: string | null): void {
  try {
    if (expectedOwnerKey !== undefined && localStorage.getItem(WEB_PUSH_OWNER_STORAGE_KEY) !== expectedOwnerKey) return;
    localStorage.removeItem(WEB_PUSH_OWNER_STORAGE_KEY);
  } catch {
    // A blocked storage area cannot be made less private by retaining a marker.
  }
}

function pushSessionCurrent(ownerKey: string, client: NonNullable<OnyxState['client']>): boolean {
  const state = getState();
  return state.connectionStatus === 'connected'
    && state.client === client
    && signedInPushOwnerKey(state) === ownerKey;
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

async function closeRegistrationNotifications(registration: ServiceWorkerRegistration): Promise<void> {
  if (typeof registration.getNotifications !== 'function') return;
  try {
    const notifications = await registration.getNotifications();
    for (const notification of notifications) notification.close();
  } catch {
    // Subscription retirement remains authoritative. Some browsers expose
    // getNotifications() but reject it outside a worker-controlled document.
  }
}

/**
 * True when this browser holds a subscription owned by the current account.
 * Unmarked and foreign-owner endpoints are retired locally before returning;
 * they must never be inherited or registered by a replacement account.
 */
export async function webPushActive(): Promise<boolean> {
  if (!webPushSupported()) return false;
  const ownerKey = signedInPushOwnerKey(getState());
  try {
    const reg = await navigator.serviceWorker.ready;
    const markedOwnerKey = readPushOwnerKey();
    const sub = await reg.pushManager.getSubscription();
    if (!sub) {
      if (!ownerKey || markedOwnerKey !== ownerKey) await closeRegistrationNotifications(reg);
      clearPushOwnerKey();
      return false;
    }
    if (ownerKey && markedOwnerKey === ownerKey && signedInPushOwnerKey(getState()) === ownerKey) return true;
    // Do not let a stale check retire a subscription after the account changed
    // while service-worker readiness was pending. The replacement check owns it.
    if (signedInPushOwnerKey(getState()) !== ownerKey) return false;
    await closeRegistrationNotifications(reg);
    if (await sub.unsubscribe()) clearPushOwnerKey(markedOwnerKey);
    return false;
  } catch {
    return false;
  }
}

/** Subscribe this browser and register it with the server. */
export async function enableWebPush(): Promise<WebPushResult> {
  if (!webPushSupported()) return { ok: false, reason: 'This browser does not support push.' };
  const initialState = getState();
  const account = selectAccount(initialState);
  const ownerKey = signedInPushOwnerKey(initialState);
  if (!account || !ownerKey) return { ok: false, reason: 'Sign in first — push is tied to your account.' };
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
  if (!pushSessionCurrent(ownerKey, client)) return { ok: false, reason: SESSION_CHANGED_REASON };

  let createdSubscription: PushSubscription | null = null;
  try {
    const reg = await navigator.serviceWorker.ready;
    if (!pushSessionCurrent(ownerKey, client)) return { ok: false, reason: SESSION_CHANGED_REASON };

    let sub = await reg.pushManager.getSubscription();
    if (!pushSessionCurrent(ownerKey, client)) return { ok: false, reason: SESSION_CHANGED_REASON };
    const markedOwnerKey = readPushOwnerKey();
    if (markedOwnerKey !== ownerKey) {
      await closeRegistrationNotifications(reg);
      if (sub) {
        if (!await sub.unsubscribe()) {
          return { ok: false, reason: 'This browser could not retire another account\'s push subscription.' };
        }
        sub = null;
      }
      clearPushOwnerKey(markedOwnerKey);
      if (!pushSessionCurrent(ownerKey, client)) return { ok: false, reason: SESSION_CHANGED_REASON };
    }
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: vapidKeyToBytes(key).buffer as ArrayBuffer,
      });
      createdSubscription = sub;
    }
    if (!pushSessionCurrent(ownerKey, client)) {
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
    if (!savePushOwnerKey(ownerKey)) {
      await sub.unsubscribe().catch(() => false);
      return { ok: false, reason: 'This browser could not bind push to the current account.' };
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
  const ownerKey = signedInPushOwnerKey(initialState);
  const client = initialState.client;
  try {
    const reg = await navigator.serviceWorker.ready;
    await closeRegistrationNotifications(reg);
    const sub = await reg.pushManager.getSubscription();
    if (!sub) {
      clearPushOwnerKey();
      return { ok: true };
    }
    const markedOwnerKey = readPushOwnerKey();

    if (!await sub.unsubscribe()) {
      return { ok: false, reason: 'The browser could not remove its push subscription.' };
    }
    clearPushOwnerKey(markedOwnerKey);

    // Never unregister an endpoint through a replacement account/session.
    // Local unsubscribe remains safe and makes the browser truthfully off.
    if (ownerKey && markedOwnerKey === ownerKey && client && pushSessionCurrent(ownerKey, client)) {
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
