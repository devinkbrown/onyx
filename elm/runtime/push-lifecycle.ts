// SPDX-License-Identifier: AGPL-3.0-or-later
import type { AccountId, EndpointId, NetworkId, OwnerRef, OwnerSnapshot, RequestContext, RequestId, RuntimeFactoryContext, SendAdmission } from './contracts';

export type PushReason = 'unsupported' | 'guest' | 'offline' | 'permission-denied' | 'subscription-failed' | 'binding-failed' | 'server-rejected' | 'timeout-unknown' | 'node-changed' | 'stale-owner' | 'storage-unavailable' | 'operation-pending' | null;
export type PushPreviewPolicy = 'private' | 'sender-only' | 'message-preview';
export interface PushIntent extends RequestContext { readonly consent: 'explicit-user' | 'recover-existing'; readonly preview: PushPreviewPolicy }
export interface PushSnapshot {
  readonly owner: OwnerSnapshot;
  readonly requestId: RequestId | null;
  readonly permission: NotificationPermission | 'unsupported';
  readonly browserSubscription: 'none' | 'present' | 'unknown';
  readonly serverRegistration: 'none' | 'pending' | 'registered' | 'removal-pending' | 'unknown' | 'failed';
  readonly delivery: 'unobserved' | 'observed';
  readonly boundNode: EndpointId | null;
  readonly reason: PushReason;
}
export type PrivatePushWireIntent = (RequestContext & { readonly node: EndpointId }) & ({ readonly verb: 'subscribe'; readonly subscription: PushSubscription } | { readonly verb: 'unsubscribe'; readonly endpoint: string });
export interface PrivatePushBinding {
  readonly schemaVersion: 1;
  readonly ownerRef: OwnerRef;
  readonly networkId: NetworkId;
  readonly accountId: AccountId;
  readonly node: EndpointId;
  readonly endpointRef: string;
  readonly endpointSha256: string;
  readonly vapidSha256: string;
  readonly explicitIntent: true;
  readonly previewPolicy: PushPreviewPolicy;
  readonly serverState: 'none' | 'pending' | 'registered' | 'removal-pending' | 'unknown';
}
export type PrivatePushReconcileReason = 'subscription-changed' | 'node-changed' | 'server-state-unknown';
export interface PrivatePushReconcileTask { readonly schemaVersion: 1; readonly ownerRef: OwnerRef; readonly networkId: NetworkId; readonly accountId: AccountId; readonly node: EndpointId; readonly reason: PrivatePushReconcileReason }
export interface PrivateWorkerSettings { readonly id: 'worker'; readonly schemaVersion: 1; readonly previewPolicy: PushPreviewPolicy }
export interface PlatformPrivateStore {
  getBinding(owner: OwnerSnapshot, node: EndpointId): Promise<PrivatePushBinding | null>;
  putBinding(owner: OwnerSnapshot, binding: PrivatePushBinding): Promise<void>;
  deleteBinding(owner: OwnerSnapshot, node: EndpointId): Promise<void>;
  listBindings(owner: OwnerSnapshot): Promise<readonly PrivatePushBinding[]>;
  putReconcileTask(task: PrivatePushReconcileTask, owner?: OwnerSnapshot): Promise<void>;
  clearReconcileTask(owner: OwnerSnapshot, node: EndpointId): Promise<void>;
  readWorkerSettings(): Promise<PrivateWorkerSettings>;
  writeWorkerSettings(settings: PrivateWorkerSettings): Promise<void>;
}
export interface PrivateNotificationAdapter {
  supported(): boolean;
  permission(): NotificationPermission | 'unsupported';
  requestPermission(): Promise<NotificationPermission>;
  closeOwnedNotifications(ownerRef: OwnerRef): Promise<void>;
  show(input: { readonly title: string; readonly body: string; readonly tag: string; readonly route: unknown; readonly previewPolicy: PushPreviewPolicy }): Promise<void>;
}
export function createBrowserNotificationAdapter(serviceWorker: ServiceWorkerContainer | null, notificationApi: typeof Notification | null = typeof Notification === 'undefined' ? null : Notification): PrivateNotificationAdapter {
  return {
    supported: () => !!serviceWorker && !!notificationApi && 'PushManager' in globalThis,
    permission: () => notificationApi?.permission ?? 'unsupported',
    requestPermission: async () => notificationApi ? notificationApi.requestPermission() : 'denied',
    async closeOwnedNotifications(ownerRef) {
      if (!serviceWorker) return;
      const registration = await serviceWorker.ready;
      const notes = await registration.getNotifications();
      for (const note of notes) if (note.tag.startsWith(`onyx:${ownerRef}:`)) note.close();
    },
    async show(input) {
      if (!serviceWorker) throw new Error('Notifications unavailable');
      const registration = await serviceWorker.ready;
      const title = input.title.replace(/[\u0000-\u001f\u007f]/gu, '').slice(0, 120) || 'Onyx notification';
      const body = input.body.replace(/[\u0000-\u001f\u007f]/gu, '').slice(0, 180) || 'You have a new notification.';
      const route = input.route && typeof input.route === 'object' ? input.route : { schemaVersion: 1, kind: 'inbox' };
      await registration.showNotification(title, { body, tag: input.tag.slice(0, 128), data: { schemaVersion: 1, route } });
    },
  };
}
export interface AuthenticatedServerReply { readonly command: 'NOTICE' | 'FAIL'; readonly failedCommand: string | null; readonly failureCode: string | null; readonly message: string; readonly owner: OwnerSnapshot; readonly node: EndpointId; readonly authenticated: boolean }
export interface PushConfig { readonly enabled: boolean; readonly vapidPublicKey: Uint8Array | null; readonly node: EndpointId }
export interface PushLifecycleDependencies extends Pick<RuntimeFactoryContext, 'ownerSnapshot' | 'isCurrent' | 'platform'> {
  readonly timeoutMs?: number;
  readonly indexedDB?: IDBFactory | null;
  readonly crypto?: Crypto | null;
};

const DB_NAME = 'onyx-platform';
const DB_VERSION = 1;
const STORES = { bindings: 'push_bindings', tasks: 'reconcile_tasks', settings: 'worker_settings' } as const;
const safeEndpointRef = () => globalThis.crypto.randomUUID();
const keyOf = (owner: OwnerSnapshot, node: EndpointId) => JSON.stringify([owner.networkId, owner.accountId, node]);
const ownedBy = (value: Pick<PrivatePushBinding, 'networkId' | 'accountId'>, owner: OwnerSnapshot) => value.networkId === owner.networkId && value.accountId === owner.accountId;
const bindingMatches = (value: PrivatePushBinding, owner: OwnerSnapshot, node: EndpointId) => ownedBy(value, owner) && value.node === node;
const isAccountOwner = (owner: OwnerSnapshot): owner is OwnerSnapshot & { accountId: AccountId } => owner.accountId !== null;
const sameOwner = (a: OwnerSnapshot, b: OwnerSnapshot) => a.ownerRef === b.ownerRef && a.networkId === b.networkId && a.accountId === b.accountId && a.accountGeneration === b.accountGeneration && a.connectionGeneration === b.connectionGeneration;

function openPlatformDb(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const store of Object.values(STORES)) if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Platform database open failed'));
    request.onblocked = () => reject(new Error('Platform database upgrade blocked'));
  });
}

function idbDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('Platform transaction failed')); });
}

/** Metadata-only account-scoped persistence; subscriptions and key bytes stay in PushManager. */
export function createPlatformPrivateStore(factory: IDBFactory | null = typeof indexedDB === 'undefined' ? null : indexedDB, isCurrent: (owner: OwnerSnapshot) => boolean = () => true): PlatformPrivateStore {
  const requireDb = () => factory ? openPlatformDb(factory) : Promise.reject(new Error('IndexedDB unavailable'));
  return {
    async getBinding(owner, node) {
      if (!isCurrent(owner)) throw new Error('Stale push owner');
      const db = await requireDb();
      try {
        const tx = db.transaction(STORES.bindings, 'readonly');
        const row = await new Promise<PrivatePushBinding | null>((resolve, reject) => {
          const request = tx.objectStore(STORES.bindings).get(keyOf(owner, node));
          request.onsuccess = () => resolve(request.result?.binding ?? null);
          request.onerror = () => reject(request.error);
        });
        await idbDone(tx);
        if (!isCurrent(owner)) throw new Error('Stale push owner');
        return row && ownedBy(row, owner) && row.node === node ? { ...row, ownerRef: owner.ownerRef } : null;
      } finally { db.close(); }
    },
    async putBinding(owner, binding) {
      if (!isCurrent(owner) || !isAccountOwner(owner) || !ownedBy(binding, owner)) throw new Error('Push binding owner mismatch');
      const db = await requireDb();
      try {
        const tx = db.transaction(STORES.bindings, 'readwrite');
        if (!isCurrent(owner)) { tx.abort(); throw new Error('Stale push owner'); }
        tx.objectStore(STORES.bindings).put({ key: keyOf(owner, binding.node), binding });
        await idbDone(tx);
        if (!isCurrent(owner)) throw new Error('Stale push owner');
      } finally { db.close(); }
    },
    async deleteBinding(owner, node) {
      const existing = await this.getBinding(owner, node);
      if (!existing || !isCurrent(owner)) return;
      const db = await requireDb();
      try { if (!isCurrent(owner)) return; const tx = db.transaction(STORES.bindings, 'readwrite'); tx.objectStore(STORES.bindings).delete(keyOf(owner, node)); await idbDone(tx); if (!isCurrent(owner)) throw new Error('Stale push owner'); }
      finally { db.close(); }
    },
    async listBindings(owner) {
      const db = await requireDb();
      try {
        const tx = db.transaction(STORES.bindings, 'readonly');
        if (!isCurrent(owner)) { tx.abort(); throw new Error('Stale push owner'); }
        const rows = await new Promise<unknown[]>((resolve, reject) => { const request = tx.objectStore(STORES.bindings).getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
        await idbDone(tx);
        if (!isCurrent(owner)) throw new Error('Stale push owner');
        return rows.map(row => (row as { binding?: PrivatePushBinding }).binding).filter((binding): binding is PrivatePushBinding => !!binding && ownedBy(binding, owner));
      } finally { db.close(); }
    },
    async putReconcileTask(task, owner) {
      if (owner && !isCurrent(owner)) throw new Error('Stale push owner');
      if (!task || task.schemaVersion !== 1 || !task.ownerRef || !task.networkId || !task.accountId || !task.node) throw new Error('Invalid reconciliation task');
      if (owner && (task.networkId !== owner.networkId || task.accountId !== owner.accountId || task.ownerRef !== owner.ownerRef)) throw new Error('Reconciliation task owner mismatch');
      const db = await requireDb();
      try {
        const tx = db.transaction(STORES.tasks, 'readwrite');
        const request = tx.objectStore(STORES.tasks).put({ key: JSON.stringify([task.networkId, task.accountId, task.node]), task });
        if (owner && !isCurrent(owner)) { tx.abort(); throw new Error('Stale push owner'); }
        request.onerror = () => { try { tx.abort(); } catch { /* transaction already completed */ } };
        await idbDone(tx);
        if (owner && !isCurrent(owner)) throw new Error('Stale push owner');
      }
      finally { db.close(); }
    },
    async clearReconcileTask(owner, node) {
      if (!isCurrent(owner)) throw new Error('Stale push owner');
      const db = await requireDb();
      try { if (!isCurrent(owner)) throw new Error('Stale push owner'); const tx = db.transaction(STORES.tasks, 'readwrite'); tx.objectStore(STORES.tasks).delete(keyOf(owner, node)); await idbDone(tx); if (!isCurrent(owner)) throw new Error('Stale push owner'); }
      finally { db.close(); }
    },
    async readWorkerSettings() {
      const db = await requireDb();
      try {
        const tx = db.transaction(STORES.settings, 'readonly');
        const row = await new Promise<PrivateWorkerSettings | null>((resolve, reject) => { const request = tx.objectStore(STORES.settings).get('worker'); request.onsuccess = () => resolve(request.result?.settings ?? null); request.onerror = () => reject(request.error); });
        await idbDone(tx);
        return row ?? { id: 'worker', schemaVersion: 1, previewPolicy: 'private' };
      } finally { db.close(); }
    },
    async writeWorkerSettings(settings) {
      const db = await requireDb();
      try { const tx = db.transaction(STORES.settings, 'readwrite'); tx.objectStore(STORES.settings).put({ key: settings.id, settings }); await idbDone(tx); }
      finally { db.close(); }
    },
  };
}

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}
async function sha256(value: BufferSource, cryptoApi: Crypto): Promise<string> {
  const digest = await cryptoApi.subtle.digest('SHA-256', value);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}
function validEndpoint(endpoint: string): boolean {
  try { const url = new URL(endpoint); return url.protocol === 'https:' && url.username === '' && url.password === '' && url.hash === '' && !/[\u0000-\u0020\u007f]/u.test(endpoint); }
  catch { return false; }
}

/** Local subscription state is separate from authenticated server registration state. */
export function createPushLifecycle(context: PushLifecycleDependencies): {
  inspect(owner: OwnerSnapshot): Promise<PushSnapshot>;
  enable(req: PushIntent): Promise<PushSnapshot>;
  disable(req: PushIntent): Promise<PushSnapshot>;
  onServerReply(reply: AuthenticatedServerReply): void;
  onNodeChange(owner: OwnerSnapshot): void;
  reconcile(req: PushIntent): Promise<PushSnapshot>;
  dispose(): void;
} {
  const deps = { ...context, ...context.platform, indexedDB: context.indexedDB, crypto: context.crypto, timeoutMs: context.timeoutMs };
  const now = deps.now ?? (() => Date.now());
  const timeoutMs = Math.max(500, Math.min(deps.timeoutMs ?? 8000, 30000));
  const inFlight = new Map<string, { owner: OwnerSnapshot; requestId: RequestId; verb: 'SUBSCRIBE' | 'UNSUBSCRIBE'; node: EndpointId; settle: (result: 'registered' | 'removed' | 'rejected' | 'unknown') => void; cancelTimer: () => void }>();
  const ambiguous = new Map<string, number>();
  const mutationLocks = new Set<string>();
  let disposed = false;
  const snapshot = (owner: OwnerSnapshot, input: Partial<PushSnapshot> = {}): PushSnapshot => ({
    owner, requestId: null, permission: deps.notifications.permission(), browserSubscription: 'unknown', serverRegistration: 'unknown',
    delivery: 'unobserved', boundNode: null, reason: null, ...input,
  });
  const current = (owner: OwnerSnapshot) => !disposed && deps.isCurrent(owner) && deps.ownerSnapshot().ownerRef === owner.ownerRef
    && deps.ownerSnapshot().accountGeneration === owner.accountGeneration;
  const key = (owner: OwnerSnapshot, node: EndpointId) => `${owner.ownerRef}:${owner.accountGeneration}:${node}`;
  const withMutation = async (req: PushIntent, operation: () => Promise<PushSnapshot>): Promise<PushSnapshot> => {
    const k = key(req.owner, deps.getPushConfig().node);
    if (mutationLocks.has(k)) return snapshot(req.owner, { requestId: req.requestId, reason: 'operation-pending' });
    mutationLocks.add(k);
    try { return await operation(); }
    finally { mutationLocks.delete(k); }
  };

  async function registration() { return deps.serviceWorker ? deps.serviceWorker.ready : null; }
  async function localSubscription(): Promise<PushSubscription | null> {
    const reg = await registration();
    return reg ? reg.pushManager.getSubscription() : null;
  }
  function awaitServer(owner: OwnerSnapshot, req: RequestContext, node: EndpointId, verb: 'SUBSCRIBE' | 'UNSUBSCRIBE'): Promise<'registered' | 'removed' | 'rejected' | 'unknown'> | null {
    const k = key(owner, node);
    if (inFlight.has(k)) return null;
    const oldGeneration = ambiguous.get(k);
    if (oldGeneration !== undefined && oldGeneration === owner.connectionGeneration) return null;
    if (oldGeneration !== undefined) ambiguous.delete(k);
    return new Promise(resolve => {
      let settled = false;
      let cancelTimer = () => {};
      const settle = (result: 'registered' | 'removed' | 'rejected' | 'unknown') => {
        if (settled) return;
        settled = true; cancelTimer(); inFlight.delete(k);
        if (result === 'unknown') ambiguous.set(k, owner.connectionGeneration);
        resolve(result);
      };
      cancelTimer = (deps.schedule ?? ((fn, ms) => { const timer = setTimeout(fn, ms); return () => clearTimeout(timer); }))(() => settle('unknown'), timeoutMs);
      inFlight.set(k, { owner, requestId: req.requestId, verb, node, settle, cancelTimer });
    });
  }
  async function send(owner: OwnerSnapshot, req: RequestContext, node: EndpointId, intent: PrivatePushWireIntent): Promise<'registered' | 'removed' | 'rejected' | 'unknown' | 'blocked' | 'busy' | 'stale'> {
    if (!current(owner) || deps.endpoint() !== node) return 'stale';
    const result = awaitServer(owner, req, node, intent.verb === 'subscribe' ? 'SUBSCRIBE' : 'UNSUBSCRIBE');
    if (!result) return 'busy';
    const admission = deps.privateSendWebPush(intent);
    if (admission.kind === 'blocked') {
      inFlight.get(key(owner, node))?.settle('rejected');
      return 'blocked';
    }
    if (admission.kind === 'unknown') {
      inFlight.get(key(owner, node))?.settle('unknown');
      return 'unknown';
    }
    const reply = await result;
    return current(owner) && deps.endpoint() === node ? reply : 'stale';
  }

  const inspect = async (owner: OwnerSnapshot): Promise<PushSnapshot> => {
    if (disposed) return snapshot(owner, { reason: 'stale-owner' });
    if (!deps.notifications.supported() || !deps.serviceWorker) return snapshot(owner, { permission: 'unsupported', browserSubscription: 'unknown', serverRegistration: 'none', reason: 'unsupported' });
    try {
      const config = deps.getPushConfig();
      const binding = await deps.privateStore.getBinding(owner, config.node);
      if (!current(owner)) return snapshot(owner, { reason: 'stale-owner' });
      if (binding && !bindingMatches(binding, owner, config.node)) return snapshot(owner, { browserSubscription: 'unknown', serverRegistration: 'unknown', boundNode: null, reason: 'binding-failed' });
      const sub = await localSubscription();
      if (!current(owner)) return snapshot(owner, { reason: 'stale-owner' });
      let bindingMatchesSubscription = false;
      if (binding && sub?.endpoint && config.vapidPublicKey && bindingMatches(binding, owner, config.node)) {
        const cryptoApi = deps.crypto ?? (typeof crypto === 'undefined' ? null : crypto);
        if (cryptoApi) bindingMatchesSubscription = await sha256(ownedArrayBuffer(new TextEncoder().encode(sub.endpoint)), cryptoApi) === binding.endpointSha256
          && await sha256(ownedArrayBuffer(config.vapidPublicKey), cryptoApi) === binding.vapidSha256;
      }
      if (!current(owner) || deps.endpoint() !== config.node) return snapshot(owner, { reason: 'stale-owner' });
      return snapshot(owner, {
        permission: deps.notifications.permission(), browserSubscription: sub ? 'present' : 'none',
        serverRegistration: binding?.serverState === 'registered' && bindingMatchesSubscription ? 'registered' : binding?.serverState === 'pending' ? 'pending' : binding?.serverState === 'removal-pending' ? 'removal-pending' : binding?.serverState === 'unknown' || binding && !bindingMatchesSubscription ? 'unknown' : 'none',
        boundNode: binding?.node ?? null,
      });
    } catch { return snapshot(owner, { reason: 'storage-unavailable' }); }
  };

  const performEnable = async (req: PushIntent): Promise<PushSnapshot> => {
    const owner = req.owner;
    if (!current(owner)) return snapshot(owner, { requestId: req.requestId, reason: 'stale-owner' });
    if (!isAccountOwner(owner)) return snapshot(owner, { requestId: req.requestId, serverRegistration: 'none', reason: 'guest' });
    const config = deps.getPushConfig();
    if (!deps.serviceWorker || !deps.notifications.supported()) return snapshot(owner, { requestId: req.requestId, permission: 'unsupported', reason: 'unsupported' });
    if (!config.enabled || !config.vapidPublicKey?.length) return snapshot(owner, { requestId: req.requestId, reason: 'subscription-failed' });
    if (!current(owner) || deps.endpoint() !== config.node) return snapshot(owner, { requestId: req.requestId, reason: 'stale-owner' });
    try {
      const existingBinding = await deps.privateStore.getBinding(owner, config.node);
      if (!current(owner)) return snapshot(owner, { requestId: req.requestId, reason: 'stale-owner' });
      if (existingBinding && !bindingMatches(existingBinding, owner, config.node)) return snapshot(owner, { requestId: req.requestId, browserSubscription: 'unknown', serverRegistration: 'unknown', boundNode: config.node, reason: 'binding-failed' });
      if (req.consent === 'recover-existing' && !existingBinding?.explicitIntent) return snapshot(owner, { requestId: req.requestId, reason: 'binding-failed' });
      const cryptoApi = deps.crypto ?? (typeof crypto === 'undefined' ? null : crypto);
      if (!cryptoApi) return snapshot(owner, { requestId: req.requestId, reason: 'subscription-failed' });
      const vapidHash = await sha256(ownedArrayBuffer(config.vapidPublicKey), cryptoApi);
      const permission = req.consent === 'explicit-user' ? await deps.notifications.requestPermission() : deps.notifications.permission();
      if (!current(owner)) return snapshot(owner, { requestId: req.requestId, permission, reason: 'stale-owner' });
      if (permission !== 'granted') return snapshot(owner, { requestId: req.requestId, permission, reason: 'permission-denied' });
      const reg = await deps.serviceWorker.ready;
      if (!current(owner)) return snapshot(owner, { requestId: req.requestId, permission, reason: 'stale-owner' });
      let sub = await reg.pushManager.getSubscription();
      if (!current(owner)) return snapshot(owner, { requestId: req.requestId, permission, reason: 'stale-owner' });
      if (sub && (!existingBinding?.explicitIntent || existingBinding.vapidSha256 !== vapidHash
        || await sha256(ownedArrayBuffer(new TextEncoder().encode(sub.endpoint)), cryptoApi) !== existingBinding.endpointSha256)) {
        if (existingBinding && owner.accountId) {
          await deps.privateStore.putBinding(owner, { ...existingBinding, serverState: 'unknown' });
          if (!current(owner)) return snapshot(owner, { requestId: req.requestId, reason: 'stale-owner' });
          await deps.privateStore.putReconcileTask({ schemaVersion: 1, ownerRef: owner.ownerRef, networkId: owner.networkId, accountId: owner.accountId, node: config.node, reason: 'subscription-changed' }, owner);
          if (!current(owner)) return snapshot(owner, { requestId: req.requestId, reason: 'stale-owner' });
        }
        return snapshot(owner, { requestId: req.requestId, permission, browserSubscription: 'present', serverRegistration: 'unknown', reason: 'binding-failed' });
      }
      if (!sub && existingBinding) {
        await deps.privateStore.putBinding(owner, { ...existingBinding, serverState: 'unknown' });
        if (!current(owner)) return snapshot(owner, { requestId: req.requestId, browserSubscription: 'none', serverRegistration: 'unknown', reason: 'stale-owner' });
        await deps.privateStore.putReconcileTask({ schemaVersion: 1, ownerRef: owner.ownerRef, networkId: owner.networkId, accountId: owner.accountId, node: config.node, reason: 'subscription-changed' }, owner);
        if (!current(owner)) return snapshot(owner, { requestId: req.requestId, reason: 'stale-owner' });
        return snapshot(owner, { requestId: req.requestId, permission, browserSubscription: 'none', serverRegistration: 'unknown', boundNode: config.node, reason: 'node-changed' });
      }
      let created = false;
      if (!sub && req.consent === 'recover-existing' && permission !== 'granted') return snapshot(owner, { requestId: req.requestId, permission, browserSubscription: 'none', reason: 'subscription-failed' });
      if (!sub) { sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: ownedArrayBuffer(config.vapidPublicKey) }); created = true; }
      if (!current(owner) || deps.endpoint() !== config.node) return snapshot(owner, { requestId: req.requestId, permission, browserSubscription: 'present', reason: 'stale-owner' });
      if (!sub.endpoint || !validEndpoint(sub.endpoint)) return snapshot(owner, { requestId: req.requestId, permission, browserSubscription: 'unknown', reason: 'subscription-failed' });
      const binding: PrivatePushBinding = {
        schemaVersion: 1, ownerRef: owner.ownerRef, networkId: owner.networkId, accountId: owner.accountId,
        node: config.node, endpointRef: safeEndpointRef(), endpointSha256: await sha256(ownedArrayBuffer(new TextEncoder().encode(sub.endpoint)), cryptoApi),
        vapidSha256: vapidHash, explicitIntent: true, previewPolicy: req.preview, serverState: 'pending',
      };
      if (!current(owner)) return snapshot(owner, { requestId: req.requestId, permission, browserSubscription: 'present', reason: 'stale-owner' });
      try { await deps.privateStore.putBinding(owner, binding); }
      catch (error) { if (created) await sub.unsubscribe().catch(() => false); throw error; }
      if (!current(owner) || deps.endpoint() !== config.node) return snapshot(owner, { requestId: req.requestId, permission, browserSubscription: 'present', serverRegistration: 'unknown', boundNode: config.node, reason: 'stale-owner' });
      const result = await send(owner, req, config.node, { schemaVersion: 1, requestId: req.requestId, owner, node: config.node, verb: 'subscribe', subscription: sub });
      if (!current(owner) || deps.endpoint() !== config.node) return snapshot(owner, { requestId: req.requestId, permission, browserSubscription: 'present', serverRegistration: 'unknown', boundNode: config.node, reason: 'stale-owner' });
      if (result === 'registered') {
        if (!current(owner)) return snapshot(owner, { requestId: req.requestId, reason: 'stale-owner' });
        await deps.privateStore.putBinding(owner, { ...binding, serverState: 'registered' });
        if (!current(owner) || deps.endpoint() !== config.node) return snapshot(owner, { requestId: req.requestId, reason: 'stale-owner' });
        return snapshot(owner, { requestId: req.requestId, permission, browserSubscription: 'present', serverRegistration: 'registered', boundNode: config.node });
      }
      if (result === 'unknown') {
        if (!current(owner)) return snapshot(owner, { requestId: req.requestId, reason: 'stale-owner' });
        await deps.privateStore.putBinding(owner, { ...binding, serverState: 'unknown' });
        if (!current(owner) || deps.endpoint() !== config.node) return snapshot(owner, { requestId: req.requestId, reason: 'stale-owner' });
        return snapshot(owner, { requestId: req.requestId, permission, browserSubscription: 'present', serverRegistration: 'unknown', boundNode: config.node, reason: 'timeout-unknown' });
      }
      if (result === 'blocked') {
        if (!current(owner)) return snapshot(owner, { requestId: req.requestId, reason: 'stale-owner' });
        await deps.privateStore.putBinding(owner, { ...binding, serverState: 'pending' });
        if (!current(owner) || deps.endpoint() !== config.node) return snapshot(owner, { requestId: req.requestId, reason: 'stale-owner' });
        return snapshot(owner, { requestId: req.requestId, permission, browserSubscription: 'present', serverRegistration: 'pending', boundNode: config.node, reason: 'offline' });
      }
      if (result === 'busy' || result === 'stale') return snapshot(owner, { requestId: req.requestId, permission, browserSubscription: 'present', serverRegistration: 'unknown', boundNode: config.node, reason: result === 'busy' ? 'timeout-unknown' : 'stale-owner' });
      await deps.privateStore.putBinding(owner, { ...binding, serverState: 'unknown' });
      if (!current(owner) || deps.endpoint() !== config.node) return snapshot(owner, { requestId: req.requestId, reason: 'stale-owner' });
      return snapshot(owner, { requestId: req.requestId, permission, browserSubscription: 'present', serverRegistration: 'failed', boundNode: config.node, reason: 'server-rejected' });
    } catch { return snapshot(owner, { requestId: req.requestId, browserSubscription: 'unknown', reason: 'subscription-failed' }); }
  };

  const performDisable = async (req: PushIntent): Promise<PushSnapshot> => {
    const owner = req.owner;
    if (!current(owner)) return snapshot(owner, { requestId: req.requestId, reason: 'stale-owner' });
    if (!isAccountOwner(owner)) return snapshot(owner, { requestId: req.requestId, reason: 'guest' });
    const config = deps.getPushConfig();
    try {
      const binding = await deps.privateStore.getBinding(owner, config.node);
      if (!current(owner)) return snapshot(owner, { requestId: req.requestId, reason: 'stale-owner' });
      if (!binding) return snapshot(owner, { requestId: req.requestId, browserSubscription: (await localSubscription()) ? 'present' : 'none', serverRegistration: 'none', boundNode: null });
      if (!bindingMatches(binding, owner, config.node)) return snapshot(owner, { requestId: req.requestId, browserSubscription: 'unknown', serverRegistration: 'unknown', boundNode: null, reason: 'binding-failed' });
      if (binding.serverState === 'registered' || binding.serverState === 'unknown' || binding.serverState === 'pending' || binding.serverState === 'removal-pending') {
        await deps.privateStore.putBinding(owner, { ...binding, serverState: 'removal-pending' });
        if (!current(owner)) return snapshot(owner, { requestId: req.requestId, reason: 'stale-owner' });
        const sub = await localSubscription();
        if (!sub?.endpoint || !validEndpoint(sub.endpoint)) {
          if (owner.accountId) await deps.privateStore.putReconcileTask({ schemaVersion: 1, ownerRef: owner.ownerRef, networkId: owner.networkId, accountId: owner.accountId, node: config.node, reason: 'server-state-unknown' }, owner);
          if (!current(owner)) return snapshot(owner, { requestId: req.requestId, reason: 'stale-owner' });
          return snapshot(owner, { requestId: req.requestId, browserSubscription: sub ? 'unknown' : 'none', serverRegistration: 'removal-pending', boundNode: config.node, reason: 'binding-failed' });
        }
        const cryptoApi = deps.crypto ?? (typeof crypto === 'undefined' ? null : crypto);
        if (!cryptoApi || await sha256(ownedArrayBuffer(new TextEncoder().encode(sub.endpoint)), cryptoApi) !== binding.endpointSha256) return snapshot(owner, { requestId: req.requestId, browserSubscription: 'unknown', serverRegistration: 'removal-pending', boundNode: config.node, reason: 'binding-failed' });
        const admissionResult = await send(owner, req, config.node, { schemaVersion: 1, requestId: req.requestId, owner, node: config.node, verb: 'unsubscribe', endpoint: sub.endpoint });
        if (!current(owner) || deps.endpoint() !== config.node) return snapshot(owner, { requestId: req.requestId, browserSubscription: 'present', serverRegistration: 'unknown', boundNode: config.node, reason: 'stale-owner' });
        if (admissionResult !== 'removed') {
          const state = admissionResult === 'unknown' || admissionResult === 'busy' ? 'unknown' : binding.serverState;
          if (!current(owner)) return snapshot(owner, { requestId: req.requestId, reason: 'stale-owner' });
          await deps.privateStore.putBinding(owner, { ...binding, serverState: state });
          return snapshot(owner, { requestId: req.requestId, browserSubscription: 'present', serverRegistration: state === 'unknown' ? 'unknown' : 'removal-pending', boundNode: config.node, reason: admissionResult === 'unknown' || admissionResult === 'busy' ? 'timeout-unknown' : 'server-rejected' });
        }
        if (!current(owner)) return snapshot(owner, { requestId: req.requestId, reason: 'stale-owner' });
        await deps.privateStore.putBinding(owner, { ...binding, serverState: 'none' });
      }
      if (!current(owner)) return snapshot(owner, { requestId: req.requestId, browserSubscription: 'present', serverRegistration: 'unknown', boundNode: config.node, reason: 'stale-owner' });
      const sub = await localSubscription();
      if (sub && !(await sub.unsubscribe())) return snapshot(owner, { requestId: req.requestId, browserSubscription: 'present', serverRegistration: 'none', boundNode: config.node, reason: 'subscription-failed' });
      if (!current(owner)) return snapshot(owner, { requestId: req.requestId, reason: 'stale-owner' });
      await deps.privateStore.deleteBinding(owner, config.node);
      if (!current(owner)) return snapshot(owner, { requestId: req.requestId, reason: 'stale-owner' });
      await deps.notifications.closeOwnedNotifications(owner.ownerRef);
      return snapshot(owner, { requestId: req.requestId, browserSubscription: 'none', serverRegistration: 'none', boundNode: null });
    } catch { return snapshot(owner, { requestId: req.requestId, browserSubscription: 'unknown', serverRegistration: 'unknown', reason: 'storage-unavailable' }); }
  };

  const enable = (req: PushIntent) => withMutation(req, () => performEnable(req));
  const disable = (req: PushIntent) => withMutation(req, () => performDisable(req));

  const onServerReply = (reply: AuthenticatedServerReply): void => {
    if (disposed || !reply.authenticated || !current(reply.owner) || reply.node !== deps.endpoint()) return;
    const pending = inFlight.get(key(reply.owner, reply.node));
    if (!pending || !sameOwner(pending.owner, reply.owner)) return;
    const success = reply.command === 'NOTICE' && reply.message === (pending.verb === 'SUBSCRIBE' ? 'WEBPUSH: subscription stored' : 'WEBPUSH: subscription removed');
    if (success) pending.settle(pending.verb === 'SUBSCRIBE' ? 'registered' : 'removed');
    else if (reply.command === 'FAIL' && reply.failedCommand === 'WEBPUSH') pending.settle('rejected');
  };
  const onNodeChange = (owner: OwnerSnapshot): void => {
    const config = deps.getPushConfig();
    for (const [keyValue, pending] of inFlight) {
      if (sameOwner(pending.owner, owner) && pending.node !== config.node) { pending.settle('unknown'); inFlight.delete(keyValue); }
    }
    void deps.privateStore.listBindings(owner).then(async bindings => {
      if (!current(owner)) return;
      for (const binding of bindings) if (binding.node !== config.node) {
        if (!current(owner)) return;
        if (owner.accountId) await deps.privateStore.putReconcileTask({ schemaVersion: 1, ownerRef: owner.ownerRef, networkId: owner.networkId, accountId: owner.accountId, node: binding.node, reason: 'node-changed' }, owner);
      }
    }).catch(() => {});
  };
  const performReconcile = async (req: PushIntent): Promise<PushSnapshot> => {
    const owner = req.owner;
    if (!current(owner)) return snapshot(owner, { requestId: req.requestId, reason: 'stale-owner' });
    const config = deps.getPushConfig();
    if (deps.endpoint() !== config.node) return snapshot(owner, { requestId: req.requestId, serverRegistration: 'unknown', boundNode: null, reason: 'node-changed' });
    try {
      const state = await inspect(owner);
      const binding = await deps.privateStore.getBinding(owner, config.node);
      const sub = await localSubscription();
      if (!current(owner)) return snapshot(owner, { requestId: req.requestId, reason: 'stale-owner' });
      if (binding && !sub) {
        await deps.privateStore.putBinding(owner, { ...binding, serverState: 'unknown' });
        if (owner.accountId) await deps.privateStore.putReconcileTask({ schemaVersion: 1, ownerRef: owner.ownerRef, networkId: owner.networkId, accountId: owner.accountId, node: binding.node, reason: 'subscription-changed' }, owner);
        if (!current(owner)) return snapshot(owner, { requestId: req.requestId, reason: 'stale-owner' });
        return { ...state, requestId: req.requestId, browserSubscription: 'none', serverRegistration: 'unknown', reason: 'node-changed' };
      }
      return { ...state, requestId: req.requestId };
    } catch { return snapshot(owner, { requestId: req.requestId, reason: 'storage-unavailable' }); }
  };
  const reconcile = (req: PushIntent) => withMutation(req, () => performReconcile(req));

  return {
    inspect, enable, disable, onServerReply, onNodeChange, reconcile,
    dispose() { disposed = true; for (const item of inFlight.values()) { item.cancelTimer(); item.settle('unknown'); } inFlight.clear(); },
  };
}
