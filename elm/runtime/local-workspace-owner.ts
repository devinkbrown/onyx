/** Explicit local-only workspace selection. Persisted rows are never evidence of
 * a live account; only a current server-proven owner can enroll an account. */
import type { AccountId, ConversationKeyScheme, LocalPhysicalEpoch, NetworkId, OwnerSnapshot, RequestContext } from './contracts';
import { canonicalTupleKey } from './contracts';

type AccountScope = {
  readonly kind: 'account'; readonly networkId: NetworkId; readonly accountId: AccountId;
  readonly physicalRef: null; readonly workspaceRef: string; readonly installationDeviceId: string;
  readonly localWorkspaceEpoch: number; readonly historyOnly?: boolean;
};
type GuestScope = {
  readonly kind: 'guest'; readonly networkId: NetworkId; readonly accountId: null;
  readonly physicalRef: LocalPhysicalEpoch; readonly workspaceRef: string; readonly installationDeviceId: string;
  readonly localWorkspaceEpoch: number;
};
export type LocalWorkspaceScope = AccountScope | GuestScope;
export type LocalOwnerGrant = { readonly scope: LocalWorkspaceScope; readonly stableLocalOwnerKey: string; readonly ref: symbol };
/** Stable storage identity; unlike localWorkspaceEpoch this survives lock/reselect. */
export function localOwnerStableKey(scope: LocalWorkspaceScope): string {
  return canonicalTupleKey(['local-owner-v1', scope.kind, scope.networkId,
    scope.kind === 'account' ? scope.accountId : scope.physicalRef, scope.installationDeviceId]);
}
export type LocalNamespaceTicket = { readonly scope: LocalWorkspaceScope; readonly ownerKey: string; readonly workspaceEpoch: number;
  readonly conversationScheme: ConversationKeyScheme | null; readonly access: 'read-only' | 'read-write'; readonly ref: symbol };
export type LocalWorkspaceMetadata = {
  readonly workspaceRef: string; readonly networkId: NetworkId; readonly accountId: AccountId | null;
  readonly remembered: boolean; readonly selected: boolean; readonly locked: boolean;
  readonly historyOnly?: boolean;
};
export type PreparedWorkspaceSelection = { readonly ref: symbol };
export interface LocalWorkspaceOwnerDeps {
  readonly indexedDB: IDBFactory | null;
  readonly configuredNetworks: () => readonly NetworkId[];
  readonly isProvenLiveOwner: (owner: OwnerSnapshot) => boolean;
  /** Current physical guest connection only; this never enrolls an account. */
  readonly isCurrentGuestOwner?: (owner: OwnerSnapshot) => boolean;
  /** True only while the UI is using an explicitly selected local workspace
   * without a live physical guest socket. A connected guest must never inherit
   * an account namespace. */
  readonly isOfflineRequest?: (request: RequestContext) => boolean;
  readonly isRequestCurrent: (request: RequestContext) => boolean;
  readonly onAuthorityLost: (scope: LocalWorkspaceScope) => void;
  readonly onConversationSchemeChanged?: (scope: LocalWorkspaceScope, previous: ConversationKeyScheme | null, next: ConversationKeyScheme) => void;
  /** Private runtime proof that this exact symbol names a successfully reviewed checkpoint. */
  readonly validateHistoryCheckpoint?: (input: { checkpointRef: symbol; networkId: NetworkId; accountId: AccountId; context: RequestContext }) => boolean;
}

type StoredAccount = { readonly schemaVersion: 1; readonly workspaceRef: string; readonly networkId: NetworkId; readonly accountId: AccountId; readonly installationDeviceId: string; readonly localWorkspaceEpoch: number; readonly remembered?: boolean; readonly historyOnly?: boolean; readonly conversationScheme?: ConversationKeyScheme };
const DB = 'onyx-local-workspaces';
const STORE = 'account-workspaces';
const CONTROL = /[\u0000-\u001f\u007f]/u;
const safe = (value: string): boolean => value.length > 0 && value.length <= 256 && !CONTROL.test(value);
function sameRequestStamp(a: RequestContext, b: RequestContext): boolean {
  return a.schemaVersion === b.schemaVersion && a.requestId === b.requestId
    && a.owner.networkId === b.owner.networkId && a.owner.accountId === b.owner.accountId
    && a.owner.accountGeneration === b.owner.accountGeneration && a.owner.connectionGeneration === b.owner.connectionGeneration
    && a.owner.physicalRef === b.owner.physicalRef && a.owner.ownerRef === b.owner.ownerRef;
}
function randomRef(): string { return [...crypto.getRandomValues(new Uint8Array(18))].map((b) => b.toString(16).padStart(2, '0')).join(''); }
function transaction(db: IDBDatabase, mode: IDBTransactionMode): { tx: IDBTransaction; done: Promise<void> } {
  const tx = db.transaction(STORE, mode);
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error ?? new Error('idb-error'));
    tx.onabort = () => reject(tx.error ?? new Error('idb-abort'));
  });
  return { tx, done };
}

export function createLocalWorkspaceOwner(deps: LocalWorkspaceOwnerDeps) {
  let dbPromise: Promise<IDBDatabase | null> | null = null;
  let selected: LocalWorkspaceScope | null = null;
  let selectedScheme: ConversationKeyScheme | null = null;
  let grantValue: LocalOwnerGrant | null = null;
  let generation = 0;
  let disposed = false;
  let workspaceAttempt = 0;
  const refs = new WeakMap<object, true>();
  const tickets = new WeakMap<object, RequestContext>();
  const guestRefs = new Map<string, LocalWorkspaceScope>();
  const guestByPhysical = new Map<string, GuestScope>();
  const memoryAccounts = new Map<string, AccountScope>();
  const initializing = new Map<string, Promise<LocalWorkspaceScope | null>>();
  const preparedSelections = new Map<symbol, { readonly previous: LocalWorkspaceScope | null; readonly generation: number;
    readonly request: RequestContext; readonly scope: AccountScope; readonly scheme: ConversationKeyScheme | null;
    readonly expiresAt: number; readonly attempt: number; readonly configuredNetworksKey: string; readonly timer: ReturnType<typeof setTimeout> }>();

  function open(): Promise<IDBDatabase | null> {
    if (!deps.indexedDB || disposed) return Promise.resolve(null);
    if (!dbPromise) dbPromise = new Promise((resolve) => {
      let request: IDBOpenDBRequest;
      try { request = deps.indexedDB!.open(DB, 1); } catch { resolve(null); return; }
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'workspaceRef' }); };
      request.onsuccess = () => { if (disposed) { request.result.close(); resolve(null); } else resolve(request.result); };
      request.onerror = request.onblocked = () => resolve(null);
    });
    return dbPromise;
  }
  function validStored(value: unknown): value is StoredAccount {
    if (!value || typeof value !== 'object') return false;
    const row = value as Partial<StoredAccount>;
    return row.schemaVersion === 1 && typeof row.workspaceRef === 'string' && safe(row.workspaceRef)
      && typeof row.networkId === 'string' && safe(row.networkId) && typeof row.accountId === 'string' && safe(row.accountId)
      && (row.remembered === undefined || typeof row.remembered === 'boolean')
      && (row.historyOnly === undefined || typeof row.historyOnly === 'boolean')
      && typeof row.installationDeviceId === 'string' && /^[a-f0-9]{32}$/u.test(row.installationDeviceId)
      && Number.isSafeInteger(row.localWorkspaceEpoch) && (row.localWorkspaceEpoch ?? -1) >= 0
      && (row.conversationScheme === undefined || (row.conversationScheme !== null
        && (row.conversationScheme.name === 'ascii' || row.conversationScheme.name === 'rfc1459' || row.conversationScheme.name === 'strict-rfc1459')
        && row.conversationScheme.revision === `irc-casemapping-v1:${row.conversationScheme.name}`));
  }
  function accountScope(row: StoredAccount): AccountScope {
    return { kind: 'account', networkId: row.networkId, accountId: row.accountId, physicalRef: null,
      workspaceRef: row.workspaceRef, installationDeviceId: row.installationDeviceId, localWorkspaceEpoch: row.localWorkspaceEpoch,
      historyOnly: row.historyOnly === true };
  }
  function setCurrent(scope: LocalWorkspaceScope, scheme: ConversationKeyScheme | null = null): LocalOwnerGrant {
    for (const [ref, value] of preparedSelections) { clearTimeout(value.timer); preparedSelections.delete(ref); }
    generation++;
    const liveScope = { ...scope, localWorkspaceEpoch: generation } as LocalWorkspaceScope;
    selected = liveScope;
    selectedScheme = scheme ? Object.freeze({ ...scheme }) : null;
    const grant = { scope: liveScope, stableLocalOwnerKey: localOwnerStableKey(liveScope), ref: Symbol('local-owner-grant') };
    refs.set(grant, true); grantValue = grant;
    return grant;
  }
  function lock(): void {
    workspaceAttempt++;
    const prior = selected;
    generation++;
    selected = null; grantValue = null;
    selectedScheme = null;
    for (const [ref, value] of preparedSelections) { clearTimeout(value.timer); preparedSelections.delete(ref); }
    if (prior) deps.onAuthorityLost(prior);
  }
  function namespaceForRequest(request: RequestContext): LocalNamespaceTicket | null {
    if (disposed || !request || request.schemaVersion !== 1 || request.requestId.length < 22 || !deps.isRequestCurrent(request) || !selected || !grantValue) return null;
    if (request.owner.networkId !== selected.networkId
      || selected.kind === 'account' && (request.owner.accountId !== null
        ? request.owner.accountId !== selected.accountId
        : !(selected.historyOnly === true && request.owner.physicalRef !== null
          || (deps.isOfflineRequest?.(request) ?? false)))) return null;
    if (selected.kind === 'guest' && (request.owner.networkId !== selected.networkId || request.owner.physicalRef !== selected.physicalRef)) return null;
    const scope = selected;
    const ownerKey = scope.kind === 'account'
      ? JSON.stringify([scope.networkId, 'account', scope.accountId])
      : JSON.stringify([scope.networkId, 'guest', scope.physicalRef]);
    const ticket: LocalNamespaceTicket = Object.freeze({ scope, ownerKey, workspaceEpoch: scope.localWorkspaceEpoch,
      conversationScheme: selectedScheme ? Object.freeze({ ...selectedScheme }) : null,
      access: scope.kind === 'account' && scope.historyOnly === true ? 'read-only' : 'read-write',
      ref: Symbol('local-namespace') });
    tickets.set(ticket, Object.freeze({ ...request, owner: Object.freeze({ ...request.owner }) }));
    return ticket;
  }
  function isNamespaceCurrent(ticket: LocalNamespaceTicket, request: RequestContext): boolean {
    const captured = ticket && tickets.get(ticket);
    return !disposed && !!captured && deps.isRequestCurrent(request) && selected === ticket.scope
      && selected.localWorkspaceEpoch === ticket.workspaceEpoch && captured.requestId === request.requestId
      && captured.owner.ownerRef === request.owner.ownerRef && captured.owner.accountId === request.owner.accountId
      && captured.owner.physicalRef === request.owner.physicalRef && captured.owner.accountGeneration === request.owner.accountGeneration
      && captured.owner.connectionGeneration === request.owner.connectionGeneration && captured.owner.networkId === request.owner.networkId;
  }
  function liveEligible(owner: OwnerSnapshot): boolean {
    if (disposed || !deps.configuredNetworks().includes(owner.networkId) || !safe(owner.networkId)) return false;
    if (owner.accountId !== null) return safe(owner.accountId) && deps.isProvenLiveOwner(owner);
    return owner.physicalRef !== null && (deps.isCurrentGuestOwner?.(owner) ?? deps.isProvenLiveOwner(owner));
  }
  function matchesLiveScope(scope: LocalWorkspaceScope | null, owner: OwnerSnapshot): scope is LocalWorkspaceScope {
    return !!scope && scope.networkId === owner.networkId && (owner.accountId !== null
      ? scope.kind === 'account' && scope.accountId === owner.accountId && scope.historyOnly !== true
      : scope.kind === 'guest' && scope.physicalRef === owner.physicalRef);
  }
  function scopeOwnerKey(owner: OwnerSnapshot): string {
    return JSON.stringify([owner.networkId, owner.accountId, owner.physicalRef]);
  }
  function ensureCurrentWorkspace(owner: OwnerSnapshot): Promise<LocalWorkspaceScope | null> {
    if (!liveEligible(owner)) return Promise.resolve(null);
    if (matchesLiveScope(selected, owner) && grantValue) return Promise.resolve(selected);
    const key = scopeOwnerKey(owner); const pending = initializing.get(key);
    if (pending) return pending;
    // Retire a prior/foreign namespace before the first asynchronous lookup.
    if (selected) lock();
    const attempt = ++workspaceAttempt;
    const startSelection = selected; const startGeneration = generation;
    const attemptCurrent = (): boolean => attempt === workspaceAttempt;
    const operation = (async (): Promise<LocalWorkspaceScope | null> => {
      if (owner.accountId === null) {
        if (!attemptCurrent() || !liveEligible(owner) || !owner.physicalRef) return null;
        const physicalKey = JSON.stringify([owner.networkId, owner.physicalRef]);
        let scope = guestByPhysical.get(physicalKey);
        if (!scope) {
          scope = { kind: 'guest', networkId: owner.networkId, accountId: null, physicalRef: owner.physicalRef,
            workspaceRef: randomRef(), installationDeviceId: randomRef().slice(0, 32), localWorkspaceEpoch: generation + 1 };
          guestByPhysical.set(physicalKey, scope); guestRefs.set(scope.workspaceRef, scope);
        }
        if (!attemptCurrent() || !liveEligible(owner) || selected !== startSelection || generation !== startGeneration) return null;
        return setCurrent(scope).scope;
      }
      const account = owner.accountId;
      if (!deps.indexedDB) {
        let scope = memoryAccounts.get(key);
        if (!scope) {
          scope = { kind: 'account', networkId: owner.networkId, accountId: account, physicalRef: null,
            workspaceRef: randomRef(), installationDeviceId: randomRef().slice(0, 32), localWorkspaceEpoch: generation + 1, historyOnly: false };
          memoryAccounts.set(key, scope);
        }
        if (!attemptCurrent() || !liveEligible(owner) || selected !== startSelection || generation !== startGeneration) return null;
        return setCurrent(scope).scope;
      }
      const database = await open();
      if (!database || !attemptCurrent() || !liveEligible(owner) || selected !== startSelection || generation !== startGeneration) return null;
      let row: StoredAccount | null = null;
      try {
        const { tx, done } = transaction(database, 'readwrite'); const store = tx.objectStore(STORE); const all = store.getAll();
        await new Promise<void>((resolve, reject) => {
          all.onsuccess = () => {
            if (!attemptCurrent() || !liveEligible(owner) || selected !== startSelection || generation !== startGeneration) {
              try { tx.abort(); } catch { /* transaction ended */ } resolve(); return;
            }
            const existing = (all.result as unknown[]).find((value): value is StoredAccount => validStored(value)
              && value.networkId === owner.networkId && value.accountId === account && value.historyOnly !== true);
            row = existing ?? { schemaVersion: 1, workspaceRef: randomRef(), networkId: owner.networkId, accountId: account,
              installationDeviceId: randomRef().slice(0, 32), localWorkspaceEpoch: 1, remembered: false };
            if (!existing) store.add(row);
            resolve();
          };
          all.onerror = () => reject(all.error ?? new Error('workspace-read'));
        });
        await done;
      } catch { return null; }
      const savedRow = row as StoredAccount | null;
      if (!savedRow || !attemptCurrent() || !liveEligible(owner) || selected !== startSelection || generation !== startGeneration) return null;
      return setCurrent(accountScope(savedRow), savedRow.conversationScheme ?? null).scope;
    })();
    initializing.set(key, operation);
    void operation.then(() => { if (initializing.get(key) === operation) initializing.delete(key); },
      () => { if (initializing.get(key) === operation) initializing.delete(key); });
    return operation;
  }

  return {
    ensureCurrentWorkspace,
    async list(): Promise<LocalWorkspaceMetadata[]> {
      if (disposed) return [];
      const database = await open(); if (!database || disposed) return [];
      try {
        const { tx, done } = transaction(database, 'readonly');
        const request = tx.objectStore(STORE).getAll();
        const result = await new Promise<unknown[]>((resolve, reject) => { request.onsuccess = () => resolve(request.result as unknown[]); request.onerror = () => reject(request.error); });
        await done;
        const configured = new Set(deps.configuredNetworks());
        return result.filter(validStored).filter((row) => configured.has(row.networkId)).map((row) => ({
          workspaceRef: row.workspaceRef, networkId: row.networkId, accountId: row.accountId,
          remembered: row.remembered !== false, selected: selected?.workspaceRef === row.workspaceRef, locked: selected?.workspaceRef !== row.workspaceRef,
          historyOnly: row.historyOnly === true,
        })).filter((row) => row.remembered || row.historyOnly);
      } catch { return []; }
    },
    async rememberProvenOwner(owner: OwnerSnapshot, explicitRememberConsent: boolean): Promise<LocalWorkspaceMetadata | null> {
      if (disposed || !deps.configuredNetworks().includes(owner.networkId) || !safe(owner.networkId)) return null;
      if (!owner.accountId) {
        if (!owner.physicalRef || !(deps.isCurrentGuestOwner?.(owner) ?? deps.isProvenLiveOwner(owner))) return null;
        const scope: GuestScope = { kind: 'guest', networkId: owner.networkId, accountId: null, physicalRef: owner.physicalRef,
          workspaceRef: randomRef(), installationDeviceId: randomRef().slice(0, 32), localWorkspaceEpoch: generation + 1 };
        guestRefs.set(scope.workspaceRef, scope); setCurrent(scope);
        return { workspaceRef: scope.workspaceRef, networkId: scope.networkId, accountId: null, remembered: false, selected: true, locked: false };
      }
      if (!deps.isProvenLiveOwner(owner)) return null;
      if (!safe(owner.accountId)) return null;
      const database = await open();
      if (!database) {
        if (explicitRememberConsent || disposed || !deps.isProvenLiveOwner(owner)) return null;
        const scope: AccountScope = { kind: 'account', networkId: owner.networkId, accountId: owner.accountId, physicalRef: null,
          workspaceRef: randomRef(), installationDeviceId: randomRef().slice(0, 32), localWorkspaceEpoch: generation + 1 };
        setCurrent(scope);
        return { workspaceRef: scope.workspaceRef, networkId: scope.networkId, accountId: scope.accountId, remembered: false, selected: true, locked: false };
      }
      if (disposed || !deps.isProvenLiveOwner(owner)) return null;
      let row: StoredAccount | null = null;
      try {
        const { tx, done } = transaction(database, 'readwrite'); const store = tx.objectStore(STORE); const all = store.getAll();
        await new Promise<void>((resolve, reject) => {
          all.onsuccess = () => {
            if (disposed || !deps.isProvenLiveOwner(owner)) { try { tx.abort(); } catch { /* transaction ended */ } resolve(); return; }
            const existing = (all.result as unknown[]).find((value): value is StoredAccount => validStored(value)
              && value.historyOnly !== true && value.networkId === owner.networkId && value.accountId === owner.accountId);
            row = existing ? { ...existing, remembered: explicitRememberConsent, historyOnly: false }
              : { schemaVersion: 1, workspaceRef: randomRef(), networkId: owner.networkId,
                accountId: owner.accountId!, installationDeviceId: randomRef().slice(0, 32), localWorkspaceEpoch: 1, remembered: explicitRememberConsent };
            if (existing) store.put(row); else store.add(row);
            resolve();
          };
          all.onerror = () => reject(all.error);
        });
        await done;
      } catch { return null; }
      if (disposed || !deps.isProvenLiveOwner(owner)) return null;
      const savedRow = row as StoredAccount | null;
      if (!savedRow) return null;
      const scope = accountScope(savedRow);
      setCurrent(scope, savedRow.conversationScheme ?? null);
      return { workspaceRef: savedRow.workspaceRef, networkId: savedRow.networkId, accountId: savedRow.accountId,
        remembered: explicitRememberConsent, selected: true, locked: false };
    },
    async select(input: { workspaceRef: string; explicitUserAction: true }): Promise<LocalWorkspaceScope | null> {
      if (disposed || input.explicitUserAction !== true || !safe(input.workspaceRef)) return null;
      const previous = selected;
      const database = await open(); if (!database || disposed) return null;
      let value: unknown;
      try {
        const { tx, done } = transaction(database, 'readonly');
        const request = tx.objectStore(STORE).get(input.workspaceRef);
        value = await new Promise<unknown>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
        await done;
      } catch { return null; }
      if (disposed || selected !== previous || !validStored(value) || value.remembered === false && value.historyOnly !== true || value.workspaceRef !== input.workspaceRef
        || !deps.configuredNetworks().includes(value.networkId)) return null;
      return setCurrent(accountScope(value), value.conversationScheme ?? null).scope;
    },
    async prepareSelection(input: { workspaceRef: string; explicitUserAction: true; context: RequestContext }): Promise<PreparedWorkspaceSelection | null> {
      const { context } = input;
      if (disposed || input.explicitUserAction !== true || !safe(input.workspaceRef) || !deps.isRequestCurrent(context)) return null;
      const previous = selected; const capturedGeneration = generation; const capturedAttempt = workspaceAttempt;
      const configuredNetworksKey = JSON.stringify([...deps.configuredNetworks()]);
      const request = Object.freeze({ ...context, owner: Object.freeze({ ...context.owner }) });
      const database = await open();
      if (!database || disposed || !deps.isRequestCurrent(context) || selected !== previous || generation !== capturedGeneration
        || workspaceAttempt !== capturedAttempt || !sameRequestStamp(request, context)
        || JSON.stringify([...deps.configuredNetworks()]) !== configuredNetworksKey) return null;
      let value: unknown;
      try {
        const { tx, done } = transaction(database, 'readonly'); const get = tx.objectStore(STORE).get(input.workspaceRef);
        value = await new Promise<unknown>((resolve, reject) => { get.onsuccess = () => resolve(get.result); get.onerror = () => reject(get.error ?? new Error('workspace-read')); });
        await done;
      } catch { return null; }
      if (disposed || !deps.isRequestCurrent(context) || selected !== previous || generation !== capturedGeneration
        || workspaceAttempt !== capturedAttempt || !sameRequestStamp(request, context)
        || JSON.stringify([...deps.configuredNetworks()]) !== configuredNetworksKey || !validStored(value)
        || value.workspaceRef !== input.workspaceRef || value.remembered === false && value.historyOnly !== true
        || !deps.configuredNetworks().includes(value.networkId)) return null;
      const owner = context.owner;
      const retiredOffline = owner.accountId === null && owner.physicalRef === null && (deps.isOfflineRequest?.(context) ?? false);
      if (owner.networkId !== value.networkId && !retiredOffline
        || owner.accountId !== null && owner.accountId !== value.accountId
        || owner.accountId === null && owner.physicalRef !== null
          && !(value.historyOnly === true || (deps.isOfflineRequest?.(context) ?? false))
        || owner.accountId === null && owner.physicalRef === null && !(deps.isOfflineRequest?.(context) ?? false)) return null;
      const ref = Symbol('prepared-workspace-selection');
      const record = { previous, generation: capturedGeneration, attempt: capturedAttempt, request, scope: accountScope(value),
        scheme: value.conversationScheme ?? null, configuredNetworksKey, expiresAt: Date.now() + 30_000,
        timer: setTimeout(() => { preparedSelections.delete(ref); }, 30_000) };
      preparedSelections.set(ref, record);
      return Object.freeze({ ref });
    },
    commitSelection(input: { prepared: PreparedWorkspaceSelection; context: RequestContext }): LocalWorkspaceScope | null {
      const record = input.prepared && typeof input.prepared === 'object' ? preparedSelections.get(input.prepared.ref) : undefined;
      const { context } = input;
      if (!record || disposed || record.expiresAt <= Date.now() || !deps.isRequestCurrent(context)
        || selected !== record.previous || generation !== record.generation || workspaceAttempt !== record.attempt
        || context.owner.accountId !== null || context.owner.physicalRef !== null || context.owner.networkId !== record.scope.networkId
        || context.owner.ownerRef === record.request.owner.ownerRef
        || context.owner.accountGeneration <= record.request.owner.accountGeneration
        || context.owner.connectionGeneration <= record.request.owner.connectionGeneration
        || !(deps.isOfflineRequest?.(context) ?? false) || !deps.configuredNetworks().includes(record.scope.networkId)
        || JSON.stringify([...deps.configuredNetworks()]) !== record.configuredNetworksKey) return null;
      // Consume synchronously before publishing the new local grant. The
      // selected account remains a storage namespace, never a live identity.
      preparedSelections.delete(input.prepared.ref); clearTimeout(record.timer);
      return setCurrent(record.scope, record.scheme).scope;
    },
    async recordAuthenticatedConversationScheme(owner: OwnerSnapshot, scheme: ConversationKeyScheme): Promise<boolean> {
      if (!liveEligible(owner) || !selected || selected.networkId !== owner.networkId
        || (selected.kind === 'account' && selected.accountId !== owner.accountId)
        || (selected.kind === 'guest' && (owner.accountId !== null || selected.physicalRef !== owner.physicalRef))
        || !scheme || !['ascii', 'rfc1459', 'strict-rfc1459'].includes(scheme.name)
        || scheme.revision !== `irc-casemapping-v1:${scheme.name}`) return false;
      if (selectedScheme?.name === scheme.name && selectedScheme.revision === scheme.revision) return true;
      const previous = selected;
      const previousScheme = selectedScheme;
      const nextScheme = Object.freeze({ name: scheme.name, revision: scheme.revision }) as ConversationKeyScheme;
      generation++;
      selected = { ...previous, localWorkspaceEpoch: generation } as LocalWorkspaceScope;
      const oldGrant = grantValue;
      if (!oldGrant) return false;
      grantValue = { scope: selected, stableLocalOwnerKey: oldGrant.stableLocalOwnerKey, ref: Symbol('local-owner-grant') };
      refs.set(grantValue, true);
      if (previous.kind === 'account') {
        const database = await open();
        const selectedAfterFence = selected;
        if (!database || disposed || !selectedAfterFence || selectedAfterFence.workspaceRef !== previous.workspaceRef || !deps.isProvenLiveOwner(owner)) return false;
        try {
          const { tx, done } = transaction(database, 'readwrite');
          const store = tx.objectStore(STORE); const get = store.get(previous.workspaceRef); let saved = false;
          await new Promise<void>((resolve, reject) => {
            get.onsuccess = () => {
              const row = get.result;
              if (validStored(row) && row.workspaceRef === previous.workspaceRef && row.networkId === owner.networkId
                && row.accountId === owner.accountId && deps.isProvenLiveOwner(owner) && selected === selectedAfterFence) {
                store.put({ ...row, conversationScheme: nextScheme }); saved = true;
              }
              resolve();
            };
            get.onerror = () => reject(get.error ?? new Error('workspace-read'));
          });
          await done;
          if (!saved || disposed || selected !== selectedAfterFence || !deps.isProvenLiveOwner(owner)) return false;
        } catch { return false; }
      }
      generation++;
      selected = { ...selected!, localWorkspaceEpoch: generation } as LocalWorkspaceScope;
      grantValue = { scope: selected, stableLocalOwnerKey: oldGrant.stableLocalOwnerKey, ref: Symbol('local-owner-grant') };
      refs.set(grantValue, true);
      selectedScheme = nextScheme;
      deps.onConversationSchemeChanged?.(selected, previousScheme, nextScheme);
      return true;
    },
    async ensureImportedHistoryWorkspace(input: { context: RequestContext; networkId: NetworkId; accountId: AccountId; checkpointRef: symbol; explicit: true }): Promise<LocalOwnerGrant | null> {
      if (disposed || input.explicit !== true || typeof input.checkpointRef !== 'symbol'
        || !deps.isRequestCurrent(input.context)
        || input.context.owner.networkId !== input.networkId
        || input.context.owner.accountId !== null && input.context.owner.accountId !== input.accountId
        || !deps.configuredNetworks().includes(input.networkId)
        || !deps.validateHistoryCheckpoint?.({ checkpointRef: input.checkpointRef, networkId: input.networkId, accountId: input.accountId, context: input.context })) return null;
      const beforeSelection = selected; const beforeGeneration = generation;
      const beforeRequest = Object.freeze({ ...input.context, owner: Object.freeze({ ...input.context.owner }) });
      const current = () => !disposed && deps.isRequestCurrent(input.context)
        && input.context.requestId === beforeRequest.requestId
        && input.context.owner.ownerRef === beforeRequest.owner.ownerRef
        && input.context.owner.accountGeneration === beforeRequest.owner.accountGeneration
        && input.context.owner.connectionGeneration === beforeRequest.owner.connectionGeneration
        && selected === beforeSelection && generation === beforeGeneration
        && deps.configuredNetworks().includes(input.networkId)
        && deps.validateHistoryCheckpoint?.({ checkpointRef: input.checkpointRef, networkId: input.networkId, accountId: input.accountId, context: input.context }) === true;
      const database = await open(); if (!database || !current()) return null;
      let row: StoredAccount | null = null;
      try {
        const { tx, done } = transaction(database, 'readwrite'); const store = tx.objectStore(STORE); const all = store.getAll();
        await new Promise<void>((resolve, reject) => {
          all.onsuccess = () => {
            if (!current()) { try { tx.abort(); } catch { /* ended */ } resolve(); return; }
            // Keep imported history in a distinct local-only workspace. Reusing a
            // normal remembered account row would silently change its authority.
            const existing = (all.result as unknown[]).find((value): value is StoredAccount => validStored(value)
              && value.historyOnly === true && value.networkId === input.networkId && value.accountId === input.accountId);
            row = existing ? { ...existing, historyOnly: true }
              : { schemaVersion: 1, workspaceRef: randomRef(), networkId: input.networkId, accountId: input.accountId,
                installationDeviceId: randomRef().slice(0, 32), localWorkspaceEpoch: 1, remembered: false, historyOnly: true };
            if (existing) store.put(row); else store.add(row);
            resolve();
          };
          all.onerror = () => reject(all.error ?? new Error('workspace-read'));
        });
        await done;
      } catch { return null; }
      const savedRow = row as StoredAccount | null;
      if (!savedRow || !current()) return null;
      return setCurrent(accountScope(savedRow), savedRow.conversationScheme ?? null);
    },
    conversationSchemeForRequest(request: RequestContext): ConversationKeyScheme | null {
      if (disposed || !request || !deps.isRequestCurrent(request) || !selected
        || request.owner.networkId !== selected.networkId
        || selected.kind === 'guest' && (request.owner.accountId !== null || request.owner.physicalRef !== selected.physicalRef)
        || selected.kind === 'account' && (request.owner.accountId !== null
          ? request.owner.accountId !== selected.accountId
          : !(selected.historyOnly === true && request.owner.physicalRef !== null
            || (deps.isOfflineRequest?.(request) ?? false)))) return null;
      return selectedScheme ? Object.freeze({ ...selectedScheme }) : null;
    },
    current: () => selected,
    grant: () => grantValue,
    namespaceForRequest,
    isNamespaceCurrent,
    validateGrant(grant: LocalOwnerGrant): boolean {
      return !disposed && grant === grantValue && refs.has(grant) && grant.ref === grantValue?.ref
        && grant.scope === selected && grant.scope.localWorkspaceEpoch === selected?.localWorkspaceEpoch;
    },
    lock,
    dispose(): void { if (disposed) return; lock(); disposed = true; void dbPromise?.then((database) => database?.close()); dbPromise = null; guestRefs.clear(); },
  };
}
