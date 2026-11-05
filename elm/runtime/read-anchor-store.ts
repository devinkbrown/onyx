import { makeReadMarkerTimestamp, type ConversationId, type MessageId, type OwnerSnapshot, type ReadMarkerTimestamp, type RequestContext } from './contracts';
import type { LocalNamespaceTicket } from './local-workspace-owner';
import { OWNED_READ_ANCHORS, openVaultV5, transactionPromise } from './migrations';

export interface ReadAnchor { readonly messageId: MessageId | null; readonly timestamp: ReadMarkerTimestamp; readonly viewportRef: string | null; readonly firstUnreadRef: MessageId | null }
interface StoredAnchor { readonly id: string; readonly ownerKey: string; readonly targetKey: string; readonly conversationId: ConversationId; readonly kind: 'accepted' | 'viewed'; readonly messageId: MessageId | null; readonly timestamp: ReadMarkerTimestamp; readonly viewportRef: string | null; readonly firstUnreadRef: MessageId | null }
export type MarkerProofRef = symbol;
export interface AcceptedMarkerProof { readonly timestamp: ReadMarkerTimestamp; readonly targetKey: string; readonly mappingRevision: string }
export interface ReadAnchorDependencies {
  readonly indexedDB?: IDBFactory;
  readonly namespaceForRequest: (request: RequestContext) => LocalNamespaceTicket | null;
  readonly isNamespaceCurrent: (ticket: LocalNamespaceTicket, request: RequestContext) => boolean;
  readonly canonicalConversationKey: (owner: OwnerSnapshot, target: ConversationId, ticket: LocalNamespaceTicket) => string | null;
  readonly conversationMappingRevision: (owner: OwnerSnapshot, ticket: LocalNamespaceTicket) => string | null;
  readonly consumeMarkerProof: (proofRef: MarkerProofRef, context: RequestContext, conversationId: ConversationId) => AcceptedMarkerProof | null;
  readonly now?: () => number;
}

export function createReadAnchorStore(deps: ReadAnchorDependencies) {
  const idb = deps.indexedDB ?? globalThis.indexedDB;
  let db: IDBDatabase | null = null; let disposed = false; let opening: Promise<boolean> | null = null;
  const active = new Set<IDBTransaction>();
  const viewed = new Map<string, ReadAnchor>();
  const ticketFor = (request: RequestContext): LocalNamespaceTicket | null => request.schemaVersion === 1 ? deps.namespaceForRequest(request) : null;
  const current = (request: RequestContext, ticket: LocalNamespaceTicket): boolean => !disposed && deps.isNamespaceCurrent(ticket, request);
  const open = async (): Promise<boolean> => {
    if (db) return true; if (!idb || disposed) return false;
    opening ??= openVaultV5({ indexedDB: idb, onVersionChange: () => { db?.close(); db = null; } }).then((r) => { if (r.kind !== 'ready' || disposed) { if (r.kind === 'ready') r.database.close(); return false; } db = r.database; return true; }).finally(() => { opening = null; });
    return opening;
  };
  const transaction = (mode: IDBTransactionMode): IDBTransaction | null => { if (!db || disposed) return null; try { const tx = db.transaction(OWNED_READ_ANCHORS, mode); active.add(tx); const drop = () => active.delete(tx); tx.addEventListener('complete', drop, { once: true }); tx.addEventListener('abort', drop, { once: true }); return tx; } catch { return null; } };
  const target = (request: RequestContext, ticket: LocalNamespaceTicket, conversationId: ConversationId): string | null => deps.canonicalConversationKey(request.owner, conversationId, ticket);
  return {
    observeLocal(request: RequestContext, conversationId: ConversationId, anchor: ReadAnchor): boolean {
      const ticket = ticketFor(request);
      if (!ticket || !current(request, ticket) || makeReadMarkerTimestamp(anchor.timestamp) === null || !target(request, ticket, conversationId)) return false;
      viewed.set(JSON.stringify([ticket.ownerKey, conversationId]), anchor); return true;
    },
    localViewed(request: RequestContext, conversationId: ConversationId): ReadAnchor | null {
      const ticket = ticketFor(request); return ticket && current(request, ticket) ? viewed.get(JSON.stringify([ticket.ownerKey, conversationId])) ?? null : null;
    },
    async get(request: RequestContext & { readonly conversationId: ConversationId }): Promise<ReadAnchor | null> {
      const ticket = ticketFor(request); if (!ticket || !current(request, ticket) || ticket.scope.kind === 'guest') return null;
      const opened = await open();
      if (!current(request, ticket) || !opened) return null;
      const targetKey = target(request, ticket, request.conversationId); const tx = transaction('readonly'); if (!targetKey || !tx) return null;
      const done = transactionPromise(tx); const req = tx.objectStore(OWNED_READ_ANCHORS).get(JSON.stringify([ticket.ownerKey, targetKey, 'accepted']));
      let row: StoredAnchor | undefined;
      try { row = await new Promise<StoredAnchor | undefined>((resolve, reject) => { req.onsuccess = () => resolve(req.result as StoredAnchor | undefined); req.onerror = () => reject(req.error); }); await done; } catch { await done.catch(() => undefined); return null; }
      if (!current(request, ticket) || !row || makeReadMarkerTimestamp(row.timestamp) === null || (row.messageId !== null && typeof row.messageId !== 'string')) return null;
      return { messageId: null, timestamp: row.timestamp, viewportRef: null, firstUnreadRef: null };
    },
    async persistAccepted(request: RequestContext & { readonly conversationId: ConversationId; readonly proofRef: MarkerProofRef }): Promise<'persisted-accepted' | 'unchanged' | 'stale-owner' | 'invalid' | 'unavailable'> {
      const ticket = ticketFor(request); if (!ticket || !current(request, ticket)) return 'stale-owner';
      if (ticket.scope.kind === 'guest') return 'stale-owner';
      const opened = await open();
      if (!current(request, ticket)) return 'stale-owner';
      if (!opened) return 'unavailable';
      const proof = deps.consumeMarkerProof(request.proofRef, request, request.conversationId);
      const anchorTime = proof ? makeReadMarkerTimestamp(proof.timestamp) : null;
      const targetKey = target(request, ticket, request.conversationId);
      if (!anchorTime || !targetKey || proof?.targetKey !== targetKey || !proof.mappingRevision || deps.conversationMappingRevision(request.owner, ticket) !== proof.mappingRevision) return 'invalid';
      const tx = transaction('readwrite'); if (!tx) return 'unavailable'; const done = transactionPromise(tx); const store = tx.objectStore(OWNED_READ_ANCHORS);
      const acceptedId = JSON.stringify([ticket.ownerKey, targetKey, 'accepted']); const get = store.get(acceptedId); let old: StoredAnchor | undefined;
      try { old = await new Promise<StoredAnchor | undefined>((resolve, reject) => { get.onsuccess = () => resolve(get.result as StoredAnchor | undefined); get.onerror = () => reject(get.error); }); }
      catch { tx.abort(); await done.catch(() => undefined); return current(request, ticket) ? 'unavailable' : 'stale-owner'; }
      if (!current(request, ticket)) { tx.abort(); await done.catch(() => undefined); return 'stale-owner'; }
      if (old && old.timestamp >= anchorTime) { tx.abort(); await done.catch(() => undefined); return 'unchanged'; }
      store.put({ id: acceptedId, ownerKey: ticket.ownerKey, targetKey, conversationId: request.conversationId, kind: 'accepted', messageId: null, timestamp: anchorTime, viewportRef: null, firstUnreadRef: null } satisfies StoredAnchor);
      try { await done; return current(request, ticket) && deps.conversationMappingRevision(request.owner, ticket) === proof.mappingRevision ? 'persisted-accepted' : 'stale-owner'; } catch { return 'unavailable'; }
    },
    async persistViewedCandidate(request: RequestContext & { readonly conversationId: ConversationId; readonly anchor: ReadAnchor }): Promise<'local-saved' | 'stale-owner' | 'invalid' | 'unavailable'> {
      const ticket = ticketFor(request); if (!ticket || !current(request, ticket)) return 'stale-owner';
      const { conversationId, anchor } = request; const timestamp = makeReadMarkerTimestamp(anchor.timestamp); const targetKey = target(request, ticket, conversationId);
      if (!timestamp || !targetKey || (anchor.messageId !== null && anchor.messageId.length > 512) || (anchor.firstUnreadRef !== null && anchor.firstUnreadRef.length > 512)) return 'invalid';
      if (ticket.scope.kind === 'guest') { viewed.set(JSON.stringify([ticket.ownerKey, conversationId]), { ...anchor, timestamp }); return 'local-saved'; }
      const opened = await open();
      if (!current(request, ticket)) return 'stale-owner';
      if (!opened) return 'unavailable';
      const tx = transaction('readwrite'); if (!tx) return 'unavailable'; const done = transactionPromise(tx);
      const row: StoredAnchor = { id: JSON.stringify([ticket.ownerKey, targetKey, 'viewed']), ownerKey: ticket.ownerKey, targetKey, conversationId, kind: 'viewed', messageId: anchor.messageId, timestamp, viewportRef: anchor.viewportRef, firstUnreadRef: anchor.firstUnreadRef };
      if (!current(request, ticket)) { tx.abort(); await done.catch(() => undefined); return 'stale-owner'; }
      tx.objectStore(OWNED_READ_ANCHORS).put(row); try { await done; return current(request, ticket) ? 'local-saved' : 'stale-owner'; } catch { return 'unavailable'; }
    },
    async getViewedCandidate(request: RequestContext & { readonly conversationId: ConversationId }): Promise<ReadAnchor | null> {
      const ticket = ticketFor(request); if (!ticket || !current(request, ticket)) return null;
      if (ticket.scope.kind === 'guest') return viewed.get(JSON.stringify([ticket.ownerKey, request.conversationId])) ?? null;
      const opened = await open();
      if (!current(request, ticket) || !opened) return null;
      const targetKey = target(request, ticket, request.conversationId); const tx = transaction('readonly'); if (!targetKey || !tx) return null;
      const done = transactionPromise(tx); const req = tx.objectStore(OWNED_READ_ANCHORS).get(JSON.stringify([ticket.ownerKey, targetKey, 'viewed'])); let row: StoredAnchor | undefined;
      try { row = await new Promise<StoredAnchor | undefined>((resolve, reject) => { req.onsuccess = () => resolve(req.result as StoredAnchor | undefined); req.onerror = () => reject(req.error); }); await done; } catch { return null; }
      if (!current(request, ticket) || !row || row.kind !== 'viewed' || makeReadMarkerTimestamp(row.timestamp) === null) return null;
      return { messageId: row.messageId, timestamp: row.timestamp, viewportRef: row.viewportRef, firstUnreadRef: row.firstUnreadRef };
    },
    async clear(request: RequestContext & { readonly conversationId: ConversationId }): Promise<boolean> {
      const ticket = ticketFor(request); if (!ticket || !current(request, ticket)) return false;
      if (ticket.scope.kind === 'guest') { viewed.delete(JSON.stringify([ticket.ownerKey, request.conversationId])); return true; }
      const opened = await open();
      if (!current(request, ticket) || !opened) return false;
      const targetKey = target(request, ticket, request.conversationId); const tx = transaction('readwrite'); if (!targetKey || !tx) return false; const done = transactionPromise(tx);
      if (!current(request, ticket)) { tx.abort(); await done.catch(() => undefined); return false; }
      tx.objectStore(OWNED_READ_ANCHORS).delete(JSON.stringify([ticket.ownerKey, targetKey, 'accepted'])); tx.objectStore(OWNED_READ_ANCHORS).delete(JSON.stringify([ticket.ownerKey, targetKey, 'viewed']));
      try { await done; return current(request, ticket); } catch { return false; }
    },
    dispose(): void { disposed = true; viewed.clear(); for (const tx of active) { try { tx.abort(); } catch { /* ended */ } } active.clear(); db?.close(); db = null; },
  };
}
