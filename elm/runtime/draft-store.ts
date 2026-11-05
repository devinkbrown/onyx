import type { ConversationId, OwnerSnapshot, RequestContext } from './contracts';
import type { LocalNamespaceTicket } from './local-workspace-owner';
import { OWNED_DRAFTS, openVaultV5, transactionPromise } from './migrations';
import type { DraftRecoveryMetadata, DraftRecoveryRecord, PrivateDraftSelectionDependencies } from './private-draft-selection';
import { createPrivateDraftSelection } from './private-draft-selection';

export interface DraftRequest extends RequestContext { readonly conversationId: ConversationId; readonly text: string; readonly revision: number }
export type DraftSaveStatus = 'saved-encrypted' | 'memory-only-unsaved' | 'quota-failed' | 'unavailable' | 'stale-owner' | 'invalid' | 'read-only';
export type DraftResult = { readonly schemaVersion: 1; readonly requestId: RequestContext['requestId']; readonly owner: OwnerSnapshot; readonly status: DraftSaveStatus };
export interface DraftMetadata { readonly conversationId: ConversationId; readonly revision: number; readonly updatedAt: number; readonly ciphertextBytes: number }
export type DraftConditionalClearResult = 'cleared' | 'unchanged' | 'stale-owner' | 'invalid' | 'unavailable' | 'read-only';
export type DraftRecoveryStatus = DraftSaveStatus | 'selection-expired' | 'revision-changed' | 'invalid-ciphertext';
export interface DraftRecoveryListResult { readonly status: 'ready' | 'unavailable' | 'stale-owner' | 'invalid'; readonly items: readonly DraftRecoveryMetadata[]; readonly truncated: boolean }
export interface DraftRecoveryResult { readonly status: DraftRecoveryStatus; readonly text: string | null; readonly conversationId: ConversationId | null; readonly revision: number | null; readonly draftRef: string | null }
export interface StoredDraftCiphertext { readonly id: string; readonly ownerKey: string; readonly ownerRef: string; readonly conversationId: ConversationId; readonly revision: number; readonly updatedAt: number; readonly nonce: Uint8Array; readonly ciphertext: Uint8Array; readonly deleted?: boolean }
export interface DraftDependencies {
  readonly indexedDB?: IDBFactory;
  readonly ownerSnapshot: () => OwnerSnapshot;
  readonly isCurrent: (owner: OwnerSnapshot) => boolean;
  readonly namespaceForRequest: (request: RequestContext) => LocalNamespaceTicket | null;
  readonly isNamespaceCurrent: (ticket: LocalNamespaceTicket, request: RequestContext) => boolean;
  readonly canonicalConversationKey: (owner: OwnerSnapshot, target: ConversationId, ticket: LocalNamespaceTicket) => string | null;
  readonly sealLocalDraft: (request: DraftRequest, ticket: LocalNamespaceTicket, conversationId: ConversationId, revision: number, plaintext: Uint8Array) => Promise<{ readonly nonce: Uint8Array; readonly ciphertext: Uint8Array } | null>;
  readonly openLocalDraft: (request: RequestContext, ticket: LocalNamespaceTicket, row: Readonly<StoredDraftCiphertext>) => Promise<Uint8Array | null>;
  readonly recoverySelection?: PrivateDraftSelectionDependencies;
  readonly now?: () => number;
}
const validText = (value: string): boolean => value.length <= 64 * 1024 && !value.includes('\u0000');
const encoder = new TextEncoder();

/** Device-bound AEAD draft store. Plaintext is never written to IndexedDB. */
export function createDraftStore(deps: DraftDependencies) {
  const idb = deps.indexedDB ?? globalThis.indexedDB;
  const now = deps.now ?? Date.now;
  let db: IDBDatabase | null = null;
  let disposed = false;
  let opening: Promise<boolean> | null = null;
  const unsaved = new Map<string, { readonly owner: OwnerSnapshot; readonly conversationId: ConversationId; readonly revision: number; readonly text: string }>();
  const recoverySelections = createPrivateDraftSelection(deps.recoverySelection ?? {
    isCurrent: deps.isCurrent,
    isNamespaceCurrent: deps.isNamespaceCurrent,
    now,
    randomRef: () => {
      const bytes = globalThis.crypto.getRandomValues(new Uint8Array(18));
      let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
      return globalThis.btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
    },
  });
  const latestRevision = new Map<string, number>();
  const active = new Set<IDBTransaction>();
  const ticketFor = (request: RequestContext): LocalNamespaceTicket | null => request.schemaVersion === 1 ? deps.namespaceForRequest(request) : null;
  const current = (request: RequestContext, ticket: LocalNamespaceTicket): boolean => !disposed && deps.isNamespaceCurrent(ticket, request);
  const open = async (): Promise<boolean> => {
    if (db) return true;
    if (!idb || disposed) return false;
    opening ??= openVaultV5({ indexedDB: idb, onVersionChange: () => { db?.close(); db = null; } }).then((opened) => {
      if (opened.kind !== 'ready' || disposed) { if (opened.kind === 'ready') opened.database.close(); return false; }
      db = opened.database; return true;
    }).finally(() => { opening = null; });
    return opening;
  };
  const makeTx = (mode: IDBTransactionMode): IDBTransaction | null => {
    if (!db || disposed) return null;
    try { const tx = db.transaction(OWNED_DRAFTS, mode); active.add(tx); const drop = () => active.delete(tx); tx.addEventListener('complete', drop, { once: true }); tx.addEventListener('abort', drop, { once: true }); return tx; } catch { return null; }
  };
  const result = (request: RequestContext, status: DraftSaveStatus): DraftResult => ({ schemaVersion: 1, requestId: request.requestId, owner: Object.freeze({ ...request.owner }), status });
  function holdUnsaved(request: DraftRequest, ticket: LocalNamespaceTicket): void {
    if (disposed || !current(request, ticket)) return;
    const id = JSON.stringify([ticket.ownerKey, request.conversationId]);
    if (request.revision < (latestRevision.get(id) ?? request.revision)) return;
    if (request.text.length > 0 && (unsaved.has(id) || unsaved.size < 20)) unsaved.set(id, { owner: request.owner, conversationId: request.conversationId, revision: request.revision, text: request.text });
  }
  async function save(request: DraftRequest): Promise<DraftResult> {
    const ticket = ticketFor(request);
    if (!ticket || !current(request, ticket)) return result(request, 'stale-owner');
    if (ticket.access !== 'read-write') return result(request, 'read-only');
    if (request.text.length > 64 * 1024 || !validText(request.text) || !Number.isSafeInteger(request.revision) || request.revision < 0) return result(request, 'invalid');
    const localId = JSON.stringify([ticket.ownerKey, request.conversationId]);
    if (request.revision < (latestRevision.get(localId) ?? -1)) return result(request, 'stale-owner');
    latestRevision.set(localId, request.revision);
    if (ticket.scope.kind === 'guest') { holdUnsaved(request, ticket); return result(request, 'memory-only-unsaved'); }
    const targetKey = deps.canonicalConversationKey(request.owner, request.conversationId, ticket);
    if (!targetKey) return result(request, 'invalid');
    const saveStartedAt = now();
    const encoded = new TextEncoder().encode(request.text);
    let sealed: { readonly nonce: Uint8Array; readonly ciphertext: Uint8Array } | null;
    try { sealed = await deps.sealLocalDraft(request, ticket, request.conversationId, request.revision, encoded); }
    catch { sealed = null; }
    finally { encoded.fill(0); }
    if (!current(request, ticket)) return result(request, 'stale-owner');
    if (!sealed || sealed.nonce.length !== 12 || sealed.ciphertext.length < 16 || sealed.ciphertext.length > 66 * 1024) {
      holdUnsaved(request, ticket);
      return result(request, 'memory-only-unsaved');
    }
    if (!current(request, ticket) || latestRevision.get(localId) !== request.revision) { holdUnsaved(request, ticket); return result(request, 'stale-owner'); }
    const opened = await open();
    if (!current(request, ticket)) return result(request, 'stale-owner');
    if (!opened) { holdUnsaved(request, ticket); return result(request, 'unavailable'); }
    const tx = makeTx('readwrite');
    if (!tx) { holdUnsaved(request, ticket); return result(request, 'unavailable'); }
    const done = transactionPromise(tx);
    const key = ticket.ownerKey;
    const row: StoredDraftCiphertext = { id: JSON.stringify([key, targetKey]), ownerKey: key, ownerRef: request.owner.ownerRef, conversationId: request.conversationId, revision: request.revision, updatedAt: saveStartedAt, nonce: sealed.nonce.slice(), ciphertext: sealed.ciphertext.slice(), deleted: false };
    try {
      if (!current(request, ticket) || latestRevision.get(localId) !== request.revision) { tx.abort(); await done.catch(() => undefined); holdUnsaved(request, ticket); return result(request, 'stale-owner'); }
      const store = tx.objectStore(OWNED_DRAFTS);
      const get = store.get(row.id);
      get.onsuccess = () => {
        const existing = get.result as StoredDraftCiphertext | undefined;
        if (!current(request, ticket) || latestRevision.get(localId) !== request.revision || (existing && (existing.updatedAt > saveStartedAt || (existing.updatedAt === saveStartedAt && existing.revision > request.revision)))) { tx.abort(); return; }
        store.put(row);
      };
      await done;
      unsaved.delete(JSON.stringify([key, request.conversationId]));
      return result(request, current(request, ticket) ? 'saved-encrypted' : 'stale-owner');
    } catch (error) {
      const status: DraftSaveStatus = (error as DOMException)?.name === 'QuotaExceededError' ? 'quota-failed' : 'unavailable';
      holdUnsaved(request, ticket);
      return result(request, status);
    }
  }
  return {
    save,
    async load(request: RequestContext & { readonly conversationId: ConversationId }): Promise<{ readonly status: DraftSaveStatus; readonly text: string | null; readonly revision: number | null }> {
      const ticket = ticketFor(request);
      if (!ticket || !current(request, ticket)) return { status: 'stale-owner', text: null, revision: null };
      if (ticket.scope.kind === 'guest') return { status: 'saved-encrypted', text: null, revision: null };
      const opened = await open();
      if (!current(request, ticket)) return { status: 'stale-owner', text: null, revision: null };
      if (!opened) return { status: 'unavailable', text: null, revision: null };
      const targetKey = deps.canonicalConversationKey(request.owner, request.conversationId, ticket);
      const tx = makeTx('readonly'); if (!tx || !targetKey) return { status: 'invalid', text: null, revision: null };
      const done = transactionPromise(tx);
      const req = tx.objectStore(OWNED_DRAFTS).get(JSON.stringify([ticket.ownerKey, targetKey]));
      let row: StoredDraftCiphertext | undefined;
      try { row = await new Promise<StoredDraftCiphertext | undefined>((resolve, reject) => { req.onsuccess = () => resolve(req.result as StoredDraftCiphertext | undefined); req.onerror = () => reject(req.error); }); }
      catch { await done.catch(() => undefined); return { status: 'unavailable', text: null, revision: null }; }
      try { await done; } catch { return { status: 'unavailable', text: null, revision: null }; }
      if (!row || row.deleted) return { status: 'saved-encrypted', text: null, revision: row?.revision ?? null };
      if (!current(request, ticket)) return { status: 'stale-owner', text: null, revision: null };
      let plaintext: Uint8Array | null;
      try { plaintext = await deps.openLocalDraft(request, ticket, row); } catch { plaintext = null; }
      if (!current(request, ticket)) { plaintext?.fill(0); return { status: 'stale-owner', text: null, revision: null }; }
      if (!plaintext) return { status: 'unavailable', text: null, revision: null };
      try { if (!current(request, ticket)) return { status: 'stale-owner', text: null, revision: null }; return { status: 'saved-encrypted', text: new TextDecoder('utf-8', { fatal: true }).decode(plaintext), revision: row.revision }; }
      catch { return { status: 'invalid', text: null, revision: null }; }
      finally { plaintext.fill(0); }
    },
    async list(request: RequestContext): Promise<readonly DraftMetadata[]> {
      const ticket = ticketFor(request);
      if (!ticket || !current(request, ticket)) return [];
      if (ticket.scope.kind === 'guest') return [];
      const opened = await open();
      if (!current(request, ticket) || !opened) return [];
      const tx = makeTx('readonly'); if (!tx) return [];
      const done = transactionPromise(tx); const output: DraftMetadata[] = [];
      const req = tx.objectStore(OWNED_DRAFTS).index('by-owner').openCursor(IDBKeyRange.only(ticket.ownerKey));
      await new Promise<void>((resolve) => { req.onsuccess = () => { const c = req.result; if (!c || output.length >= 100) { resolve(); return; } const row = c.value as StoredDraftCiphertext; if (current(request, ticket) && row && !row.deleted && row.ciphertext instanceof Uint8Array) output.push({ conversationId: row.conversationId, revision: row.revision, updatedAt: row.updatedAt, ciphertextBytes: row.ciphertext.byteLength }); c.continue(); }; req.onerror = () => resolve(); });
      await done.catch(() => undefined); return current(request, ticket) ? output : [];
    },
    async delete(request: RequestContext & { readonly conversationId: ConversationId }): Promise<DraftResult> {
      const ticket = ticketFor(request);
      if (!ticket || !current(request, ticket)) return result(request, 'stale-owner');
      if (ticket.access !== 'read-write') return result(request, 'read-only');
      if (ticket.scope.kind === 'guest') { unsaved.delete(JSON.stringify([ticket.ownerKey, request.conversationId])); return result(request, 'saved-encrypted'); }
      const targetKey = deps.canonicalConversationKey(request.owner, request.conversationId, ticket);
      if (!targetKey) return result(request, 'unavailable');
      const opened = await open();
      if (!current(request, ticket)) return result(request, 'stale-owner');
      if (!opened) return result(request, 'unavailable');
      const tx = makeTx('readwrite'); if (!tx) return result(request, 'unavailable');
      const done = transactionPromise(tx); const id = JSON.stringify([ticket.ownerKey, targetKey]);
      const localId = JSON.stringify([ticket.ownerKey, request.conversationId]);
      const nextRevision = (latestRevision.get(localId) ?? 0) + 1;
      latestRevision.set(localId, nextRevision);
      const store = tx.objectStore(OWNED_DRAFTS); const get = store.get(id);
      get.onsuccess = () => {
        if (!current(request, ticket)) { tx.abort(); return; }
        const existing = get.result as StoredDraftCiphertext | undefined;
        store.put({ id, ownerKey: ticket.ownerKey, ownerRef: request.owner.ownerRef, conversationId: request.conversationId, revision: Math.max(nextRevision, (existing?.revision ?? 0) + 1), updatedAt: now(), nonce: new Uint8Array(), ciphertext: new Uint8Array(), deleted: true } satisfies StoredDraftCiphertext);
      };
      try { await done; unsaved.delete(localId); return result(request, current(request, ticket) ? 'saved-encrypted' : 'stale-owner'); } catch { return result(request, 'unavailable'); }
    },
    /** Remove only the exact autosave revision captured by the accepted send. */
    async clearIfRevision(request: RequestContext & { readonly conversationId: ConversationId; readonly revision: number }): Promise<DraftConditionalClearResult> {
      const ticket = ticketFor(request);
      if (!ticket || !current(request, ticket)) return 'stale-owner';
      if (ticket.access !== 'read-write') return 'read-only';
      if (!Number.isSafeInteger(request.revision) || request.revision < 0 || request.revision >= Number.MAX_SAFE_INTEGER || !request.conversationId || request.conversationId.length > 512) return 'invalid';
      const localId = JSON.stringify([ticket.ownerKey, request.conversationId]);
      const currentRevision = latestRevision.get(localId);
      if (currentRevision !== undefined && currentRevision > request.revision) return 'unchanged';
      // Fence a save already sealing this exact accepted revision before the
      // first await. A later autosave revision remains eligible to commit.
      latestRevision.set(localId, Math.max(currentRevision ?? request.revision, request.revision) + 1);
      const unsavedValue = unsaved.get(localId);
      if (ticket.scope.kind === 'guest') {
        if (!unsavedValue || unsavedValue.revision !== request.revision) return 'unchanged';
        if (!current(request, ticket)) return 'stale-owner';
        unsaved.delete(localId);
        return 'cleared';
      }
      const targetKey = deps.canonicalConversationKey(request.owner, request.conversationId, ticket);
      if (!targetKey) return 'invalid';
      const opened = await open();
      if (!current(request, ticket)) return 'stale-owner';
      if (!opened) return 'unavailable';
      const tx = makeTx('readwrite');
      if (!tx) return 'unavailable';
      const done = transactionPromise(tx);
      const id = JSON.stringify([ticket.ownerKey, targetKey]);
      const store = tx.objectStore(OWNED_DRAFTS);
      const get = store.get(id);
      const outcome: { value: DraftConditionalClearResult } = { value: 'unchanged' };
      get.onsuccess = () => {
        if (!current(request, ticket)) { outcome.value = 'stale-owner'; tx.abort(); return; }
        const row = get.result as StoredDraftCiphertext | undefined;
        if (!row || row.revision !== request.revision) return;
        store.delete(id);
        outcome.value = 'cleared';
      };
      try {
        await done;
        if (!current(request, ticket)) return 'stale-owner';
        if (outcome.value === 'cleared' && unsaved.get(localId)?.revision === request.revision) unsaved.delete(localId);
        return outcome.value;
      } catch { return current(request, ticket) ? 'unavailable' : 'stale-owner'; }
    },
    async listRecoverable(request: RequestContext): Promise<DraftRecoveryListResult> {
      const ticket = ticketFor(request);
      if (!ticket || !current(request, ticket)) return { status: 'stale-owner', items: [], truncated: false };
      if (ticket.scope.kind !== 'account') return { status: 'ready', items: recoverySelections.replace(request, ticket, []) ?? [], truncated: false };
      const opened = await open();
      if (!current(request, ticket)) return { status: 'stale-owner', items: [], truncated: false };
      if (!opened) return { status: 'unavailable', items: [], truncated: false };
      const tx = makeTx('readonly'); if (!tx) return { status: 'unavailable', items: [], truncated: false };
      const done = transactionPromise(tx);
      const records: DraftRecoveryRecord[] = [];
      let invalid = false;
      let truncated = false;
      const cursorRequest = tx.objectStore(OWNED_DRAFTS).index('by-owner').openCursor(IDBKeyRange.only(ticket.ownerKey));
      const cursorResult = new Promise<void>((resolve) => {
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor || records.length >= 101 || !current(request, ticket)) { truncated = !!cursor && records.length >= 101; resolve(); return; }
          const row = cursor.value as StoredDraftCiphertext;
          if (!row || row.ownerKey !== ticket.ownerKey || typeof row.conversationId !== 'string' || row.conversationId.length === 0 || row.conversationId.length > 512
            || !Number.isSafeInteger(row.revision) || row.revision < 0 || !Number.isSafeInteger(row.updatedAt) || row.updatedAt < 0
            || !(row.nonce instanceof Uint8Array) || !(row.ciphertext instanceof Uint8Array)) {
            invalid = true; resolve(); return;
          }
          if (row.deleted !== true) {
            const targetKey = deps.canonicalConversationKey(request.owner, row.conversationId, ticket);
            if (!targetKey || row.id !== JSON.stringify([ticket.ownerKey, targetKey]) || row.nonce.byteLength !== 12
              || row.ciphertext.byteLength < 16 || row.ciphertext.byteLength > 66 * 1024) { invalid = true; resolve(); return; }
            records.push({ rowId: row.id, ownerKey: row.ownerKey, targetKey, conversationId: row.conversationId,
              revision: row.revision, updatedAtMs: row.updatedAt, ciphertextBytes: row.ciphertext.byteLength });
          }
          cursor.continue();
        };
        cursorRequest.onerror = () => { invalid = true; resolve(); };
      });
      try { await cursorResult; await done; } catch { return { status: 'unavailable', items: [], truncated: false }; }
      if (!current(request, ticket)) return { status: 'stale-owner', items: [], truncated: false };
      if (invalid) { recoverySelections.replace(request, ticket, []); return { status: 'invalid', items: [], truncated: false }; }
      const visibleRecords = records.slice(0, 100);
      truncated ||= records.length > 100;
      const items = recoverySelections.replace(request, ticket, visibleRecords);
      if (!items) return { status: 'invalid', items: [], truncated: false };
      return { status: 'ready', items, truncated };
    },
    async recoverExplicit(request: RequestContext & { readonly draftRef: string }): Promise<DraftRecoveryResult> {
      const ticket = ticketFor(request);
      if (!ticket || !current(request, ticket)) return { status: 'stale-owner', text: null, conversationId: null, revision: null, draftRef: null };
      const selection = recoverySelections.consume(request, ticket, request.draftRef);
      if (!selection) return { status: 'selection-expired', text: null, conversationId: null, revision: null, draftRef: null };
      const empty = (status: DraftRecoveryStatus): DraftRecoveryResult => ({ status, text: null, conversationId: selection.conversationId, revision: selection.revision, draftRef: selection.draftRef });
      if (ticket.scope.kind !== 'account' || selection.ownerKey !== ticket.ownerKey || selection.targetKey !== deps.canonicalConversationKey(request.owner, selection.conversationId, ticket)) return empty('stale-owner');
      const opened = await open();
      if (!current(request, ticket)) return empty('stale-owner');
      if (!opened) return empty('unavailable');
      const readExactRow = async (): Promise<{ readonly kind: 'row'; readonly row: StoredDraftCiphertext } | { readonly kind: 'missing' | 'unavailable' }> => {
        const tx = makeTx('readonly'); if (!tx) return { kind: 'unavailable' };
        const done = transactionPromise(tx); const get = tx.objectStore(OWNED_DRAFTS).get(selection.rowId);
        let row: StoredDraftCiphertext | undefined;
        try {
          row = await new Promise<StoredDraftCiphertext | undefined>((resolve, reject) => {
            get.onsuccess = () => resolve(get.result as StoredDraftCiphertext | undefined);
            get.onerror = () => reject(get.error);
          });
          await done;
          return row ? { kind: 'row', row } : { kind: 'missing' };
        } catch { await done.catch(() => undefined); return { kind: 'unavailable' }; }
      };
      const matchesSelection = (row: StoredDraftCiphertext | null): row is StoredDraftCiphertext => !!row && !row.deleted
        && row.id === selection.rowId && row.ownerKey === selection.ownerKey && row.conversationId === selection.conversationId
        && row.revision === selection.revision && row.updatedAt === selection.updatedAtMs
        && row.ciphertext instanceof Uint8Array && row.ciphertext.byteLength === selection.ciphertextBytes
        && row.nonce instanceof Uint8Array && row.nonce.byteLength === 12;
      if (!current(request, ticket)) return empty('stale-owner');
      const firstRead = await readExactRow();
      if (!current(request, ticket)) return empty('stale-owner');
      if (firstRead.kind === 'unavailable') return empty('unavailable');
      const row = firstRead.kind === 'row' ? firstRead.row : null;
      if (!row || row.revision !== selection.revision || row.updatedAt !== selection.updatedAtMs) return empty('revision-changed');
      if (!matchesSelection(row)) return empty('invalid-ciphertext');
      let plaintext: Uint8Array | null;
      try { plaintext = await deps.openLocalDraft(request, ticket, row); } catch { plaintext = null; }
      if (!current(request, ticket)) { plaintext?.fill(0); return empty('stale-owner'); }
      if (!plaintext) return empty('invalid-ciphertext');
      try {
        let text: string;
        try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(plaintext); }
        catch { return empty('invalid-ciphertext'); }
        if (plaintext.byteLength > 64 * 1024 || encoder.encode(text).byteLength > 64 * 1024 || text.includes('\u0000')) return empty('invalid-ciphertext');
        const afterRead = await readExactRow();
        if (!current(request, ticket)) return empty('stale-owner');
        if (afterRead.kind === 'unavailable') return empty('unavailable');
        const after = afterRead.kind === 'row' ? afterRead.row : null;
        if (!matchesSelection(after) || !after.ciphertext.every((byte, index) => byte === row.ciphertext[index])
          || !after.nonce.every((byte, index) => byte === row.nonce[index])) return empty('revision-changed');
        if (!current(request, ticket)) return empty('stale-owner');
        return { status: 'saved-encrypted', text, conversationId: selection.conversationId, revision: selection.revision, draftRef: selection.draftRef };
      } finally { plaintext.fill(0); }
    },
    unsavedText(request: RequestContext, conversationId: ConversationId): string | null { const ticket = ticketFor(request); return ticket && current(request, ticket) ? unsaved.get(JSON.stringify([ticket.ownerKey, conversationId]))?.text ?? null : null; },
    retireOwner(owner: OwnerSnapshot): void { recoverySelections.retireOwner(owner); },
    retireScope(scope: import('./local-workspace-owner').LocalWorkspaceScope): void { recoverySelections.retireScope(scope); },
    dispose(): void { disposed = true; recoverySelections.dispose(); unsaved.clear(); latestRevision.clear(); for (const tx of active) { try { tx.abort(); } catch { /* ended */ } } active.clear(); db?.close(); db = null; },
  };
}
