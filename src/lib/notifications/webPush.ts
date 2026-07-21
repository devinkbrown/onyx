// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * webPush.ts — browser Web Push subscription against Onyx Server's WEBPUSH command
 * (Roadmap Phase 2.4: reach you with the tab closed).
 *
 * Flow: read the server's VAPID public key from ISUPPORT (`VAPID=`, no
 * round-trip), subscribe through the service worker's PushManager, then hand
 * the endpoint + keys to the server (`WEBPUSH SUBSCRIBE`). The server pushes an RFC 8291
 * end-to-end-encrypted payload when a DM lands while no session is attached;
 * the service worker renders it. Account-scoped: guests can't subscribe.
 *
 * Recovery: `recoverWebPush` re-binds after reconnect / SW update / expired
 * endpoint when the user previously enabled push (intent marker). Every failure
 * returns a typed reason — never a silent no-op.
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

/**
 * Validate the uncompressed P-256 public-key shape PushManager requires.
 * ISUPPORT carries base64url without padding — reject standard-base64 aliases
 * and any decode that is not a 65-byte uncompressed point (0x04 ‖ X ‖ Y).
 */
function applicationServerKeyFromIsupport(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) return null;
  try {
    const bytes = vapidKeyToBytes(value);
    return bytes.length === 65 && bytes[0] === 0x04 ? bytes : null;
  } catch {
    return null;
  }
}

function applicationServerKeyBuffer(bytes: Uint8Array): ArrayBuffer {
  // Slice so the BufferSource is exactly the key bytes even when the view
  // sits on a larger ArrayBuffer (never hand PushManager a shared tail).
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
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
const NO_INTENT_REASON = 'Push is not enabled on this browser.';
export const WEB_PUSH_OWNER_STORAGE_KEY = 'onyx:web-push-owner';
/** Survives expired/missing browser subscriptions so recovery can re-bind. */
export const WEB_PUSH_INTENT_STORAGE_KEY = 'onyx:web-push-intent';

function signedInPushOwnerKey(state: OnyxState): string | null {
  if (!selectAccount(state)) return null;
  const owner = selectDeviceMemoryOwner(state);
  return owner ? deviceMemoryOwnerKey(owner) : null;
}

function readStorageKey(key: string): string | null {
  try {
    const value = localStorage.getItem(key);
    return value && value.length <= 4_096 ? value : null;
  } catch {
    return null;
  }
}

function saveStorageKey(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function clearStorageKey(key: string, expectedValue?: string | null): void {
  try {
    if (expectedValue !== undefined && localStorage.getItem(key) !== expectedValue) return;
    localStorage.removeItem(key);
  } catch {
    // A blocked storage area cannot be made less private by retaining a marker.
  }
}

function readPushOwnerKey(): string | null {
  return readStorageKey(WEB_PUSH_OWNER_STORAGE_KEY);
}

function savePushOwnerKey(ownerKey: string): boolean {
  return saveStorageKey(WEB_PUSH_OWNER_STORAGE_KEY, ownerKey);
}

function clearPushOwnerKey(expectedOwnerKey?: string | null): void {
  clearStorageKey(WEB_PUSH_OWNER_STORAGE_KEY, expectedOwnerKey);
}

function readPushIntentKey(): string | null {
  return readStorageKey(WEB_PUSH_INTENT_STORAGE_KEY);
}

function savePushIntentKey(ownerKey: string): boolean {
  return saveStorageKey(WEB_PUSH_INTENT_STORAGE_KEY, ownerKey);
}

function clearPushIntentKey(expectedOwnerKey?: string | null): void {
  clearStorageKey(WEB_PUSH_INTENT_STORAGE_KEY, expectedOwnerKey);
}

/** True when the signed-in account previously enabled push on this browser. */
export function webPushIntentDesired(): boolean {
  const ownerKey = signedInPushOwnerKey(getState());
  return Boolean(ownerKey && readPushIntentKey() === ownerKey);
}

function pushSessionCurrent(ownerKey: string, client: NonNullable<OnyxState['client']>): boolean {
  const state = getState();
  return state.connectionStatus === 'connected'
    && state.client === client
    && signedInPushOwnerKey(state) === ownerKey;
}

function pushCleanupScopeCurrent(
  appOwnerKey: string | null,
  markedOwnerKey: string | null,
): boolean {
  return signedInPushOwnerKey(getState()) === appOwnerKey
    && readPushOwnerKey() === markedOwnerKey;
}

function subscriptionKeysComplete(subscription: PushSubscription): {
  complete: true;
  endpoint: string;
  p256dh: string;
  auth: string;
} | { complete: false } {
  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!subscription.endpoint || !p256dh || !auth) return { complete: false };
  return { complete: true, endpoint: subscription.endpoint, p256dh, auth };
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

/**
 * Drop a half-finished enable: clear the ownership claim first so a concurrent
 * webPushActive() cannot treat an unregistered endpoint as working push, then
 * retire any subscription this enable created. The expected-value guard on
 * clearPushOwnerKey preserves a replacement owner's marker.
 *
 * Intent is intentionally preserved — a transient register failure must not
 * erase the user's opt-in so recoverWebPush can retry after reconnect.
 */
async function rollBackFailedRegistration(
  ownerKey: string,
  createdSubscription: PushSubscription | null,
): Promise<void> {
  clearPushOwnerKey(ownerKey);
  await discardCreatedSubscription(createdSubscription);
}

async function closeRegistrationNotifications(
  registration: ServiceWorkerRegistration,
  stillCurrent: () => boolean = () => true,
): Promise<boolean> {
  if (!stillCurrent()) return false;
  if (typeof registration.getNotifications !== 'function') return stillCurrent();
  try {
    const notifications = await registration.getNotifications();
    if (!stillCurrent()) return false;
    for (const notification of notifications) notification.close();
    return true;
  } catch {
    // Subscription retirement remains authoritative. Some browsers expose
    // getNotifications() but reject it outside a worker-controlled document.
    return stillCurrent();
  }
}

/**
 * True when this browser holds a subscription owned by the current account.
 * Unmarked and foreign-owner endpoints are retired locally before returning;
 * they must never be inherited or registered by a replacement account.
 *
 * A missing subscription clears the ownership claim but keeps the intent
 * marker so recoverWebPush can re-subscribe after expiry / SW update.
 */
export async function webPushActive(): Promise<boolean> {
  if (!webPushSupported()) return false;
  const ownerKey = signedInPushOwnerKey(getState());
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    const markedOwnerKey = readPushOwnerKey();
    const cleanupScopeCurrent = () => pushCleanupScopeCurrent(ownerKey, markedOwnerKey);
    if (!sub) {
      if (!cleanupScopeCurrent()) return false;
      if (!ownerKey || markedOwnerKey !== ownerKey) {
        if (!await closeRegistrationNotifications(reg, cleanupScopeCurrent) || !cleanupScopeCurrent()) {
          return false;
        }
      }
      clearPushOwnerKey(markedOwnerKey);
      return false;
    }
    if (ownerKey && markedOwnerKey === ownerKey && cleanupScopeCurrent()) return true;
    if (!cleanupScopeCurrent()) return false;
    if (!await closeRegistrationNotifications(reg, cleanupScopeCurrent) || !cleanupScopeCurrent()) {
      return false;
    }
    if (await sub.unsubscribe()) clearPushOwnerKey(markedOwnerKey);
    return false;
  } catch {
    return false;
  }
}

type RegisterMode = 'enable' | 'recover';

/**
 * Shared subscribe + server registration path.
 *
 * Gate order (load-bearing):
 *   supported → signed-in account → connected session → VAPID shape
 *   → permission (prompt only for enable) → [recover: intent]
 *   → retire foreign/incomplete → subscribe if needed → complete keys
 *   → owner+intent markers → WEBPUSH SUBSCRIBE
 *
 * VAPID is validated before any permission prompt so a misconfigured server
 * never asks the user for notification access.
 */
async function registerWebPush(mode: RegisterMode): Promise<WebPushResult> {
  if (!webPushSupported()) return { ok: false, reason: 'This browser does not support push.' };
  const initialState = getState();
  const account = selectAccount(initialState);
  const ownerKey = signedInPushOwnerKey(initialState);
  if (!account || !ownerKey) return { ok: false, reason: 'Sign in first — push is tied to your account.' };
  if (initialState.connectionStatus !== 'connected' || !initialState.client) {
    return { ok: false, reason: 'Reconnect first.' };
  }
  const client = initialState.client;
  // VAPID is advertised on ISUPPORT (`VAPID=`); never invent or round-trip a key.
  // Shape-check before permission so a misconfigured server never prompts.
  const advertisedKey = client.isupport.VAPID ?? '';
  if (!advertisedKey) return { ok: false, reason: 'Push is not enabled on this server.' };
  const keyBytes = applicationServerKeyFromIsupport(advertisedKey);
  if (!keyBytes) return { ok: false, reason: 'Push is misconfigured on this server.' };
  const applicationServerKey = applicationServerKeyBuffer(keyBytes);

  if (mode === 'recover' && readPushIntentKey() !== ownerKey) {
    return { ok: false, reason: NO_INTENT_REASON };
  }

  let permission: NotificationPermission;
  if (mode === 'enable') {
    try {
      permission = await Notification.requestPermission();
    } catch {
      return { ok: false, reason: 'Requesting notification permission failed.' };
    }
  } else {
    // Recovery never prompts — permission must already be granted (site
    // settings, prior enable, or an external grant while the tab was open).
    try {
      permission = Notification.permission;
    } catch {
      return { ok: false, reason: 'Requesting notification permission failed.' };
    }
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
      const cleanupScopeCurrent = () => (
        pushSessionCurrent(ownerKey, client)
        && readPushOwnerKey() === markedOwnerKey
      );
      if (!await closeRegistrationNotifications(reg, cleanupScopeCurrent) || !cleanupScopeCurrent()) {
        return { ok: false, reason: SESSION_CHANGED_REASON };
      }
      if (sub) {
        if (!await sub.unsubscribe()) {
          return { ok: false, reason: 'This browser could not retire another account\'s push subscription.' };
        }
        sub = null;
      }
      clearPushOwnerKey(markedOwnerKey);
      if (!pushSessionCurrent(ownerKey, client)) return { ok: false, reason: SESSION_CHANGED_REASON };
    }

    // Incomplete keys are unusable — retire and create a fresh subscription
    // once rather than fail closed on a half-formed browser endpoint.
    if (sub && !subscriptionKeysComplete(sub).complete) {
      try {
        await sub.unsubscribe();
      } catch {
        // Fall through to a fresh subscribe; if the dead sub lingers, subscribe
        // will either replace it or throw into the outer catch.
      }
      sub = null;
      if (!pushSessionCurrent(ownerKey, client)) return { ok: false, reason: SESSION_CHANGED_REASON };
    }

    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });
      createdSubscription = sub;
    }
    if (!pushSessionCurrent(ownerKey, client)) {
      await rollBackFailedRegistration(ownerKey, createdSubscription);
      return { ok: false, reason: SESSION_CHANGED_REASON };
    }

    const keys = subscriptionKeysComplete(sub);
    if (!keys.complete) {
      // Still incomplete after a fresh subscribe — retire and fail closed.
      await rollBackFailedRegistration(ownerKey, createdSubscription ?? sub);
      return { ok: false, reason: 'The browser returned an incomplete subscription.' };
    }
    if (!savePushOwnerKey(ownerKey) || !savePushIntentKey(ownerKey)) {
      // Ownership + intent are the gates for active/recover — without both,
      // retire any sub this registration created (or the unusable endpoint).
      clearPushOwnerKey(ownerKey);
      clearPushIntentKey(ownerKey);
      await discardCreatedSubscription(createdSubscription ?? sub);
      return { ok: false, reason: 'This browser could not bind push to the current account.' };
    }
    // sendRaw returns false when the socket cannot carry the registration —
    // never report ok while the server has not learned the endpoint.
    if (!client.sendRaw('WEBPUSH', 'SUBSCRIBE', keys.endpoint, keys.p256dh, keys.auth)) {
      // Always drop ownership + any sub created here. Intent stays so recover
      // can retry after reconnect. For a reused endpoint the browser
      // subscription stays until the next enable/active reconciliation
      // (unsubscribing would silently disable a prior working registration).
      await rollBackFailedRegistration(ownerKey, createdSubscription);
      return {
        ok: false,
        reason: 'The connection closed before push could be registered. Reconnect and try again.',
      };
    }
    return { ok: true };
  } catch {
    await rollBackFailedRegistration(ownerKey, createdSubscription);
    return { ok: false, reason: 'Subscribing failed — check site notification settings.' };
  }
}

/** Subscribe this browser and register it with the server. */
export async function enableWebPush(): Promise<WebPushResult> {
  return registerWebPush('enable');
}

/**
 * Re-bind push after reconnect, permission grant, service-worker update, or an
 * expired endpoint. Requires a prior successful enable (intent marker) and an
 * already-granted notification permission — never prompts and never silently
 * reports success when it did no work.
 */
export async function recoverWebPush(): Promise<WebPushResult> {
  return registerWebPush('recover');
}

/** Drop this browser's subscription locally and on the server. */
export async function disableWebPush(): Promise<WebPushResult> {
  if (!webPushSupported()) return { ok: false, reason: 'This browser does not support push.' };
  const initialState = getState();
  const ownerKey = signedInPushOwnerKey(initialState);
  const markedOwnerKey = readPushOwnerKey();
  const client = initialState.client;
  const cleanupScopeCurrent = () => pushCleanupScopeCurrent(ownerKey, markedOwnerKey);
  try {
    const reg = await navigator.serviceWorker.ready;
    if (!cleanupScopeCurrent()) return { ok: false, reason: SESSION_CHANGED_REASON };
    if (!await closeRegistrationNotifications(reg, cleanupScopeCurrent) || !cleanupScopeCurrent()) {
      return { ok: false, reason: SESSION_CHANGED_REASON };
    }
    const sub = await reg.pushManager.getSubscription();
    if (!cleanupScopeCurrent()) return { ok: false, reason: SESSION_CHANGED_REASON };
    if (!sub) {
      clearPushOwnerKey(markedOwnerKey);
      // Explicit disable clears this account's recovery intent.
      if (ownerKey) clearPushIntentKey(ownerKey);
      return { ok: true };
    }

    if (!await sub.unsubscribe()) {
      return { ok: false, reason: 'The browser could not remove its push subscription.' };
    }
    clearPushOwnerKey(markedOwnerKey);
    if (ownerKey) clearPushIntentKey(ownerKey);

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
