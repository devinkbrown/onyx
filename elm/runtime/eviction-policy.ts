import type { ConversationId, OwnerSnapshot, RequestContext } from './contracts';
import type { LocalNamespaceTicket } from './local-workspace-owner';

export interface EvictableHistoryRow { readonly owner: OwnerSnapshot; readonly conversationId: ConversationId; readonly recordId: string; readonly atMs: number; readonly accepted: boolean; readonly redacted: boolean }
export interface RetentionBounds { readonly keep: number; readonly ephemeralSeconds: number | null }
export interface EvictionPreview { readonly ownerRef: string; readonly conversationId: ConversationId; readonly count: number; readonly cutoffMs: number | null }
const sameOwner = (a: OwnerSnapshot, b: OwnerSnapshot): boolean => a.networkId === b.networkId && a.accountId === b.accountId && a.accountGeneration === b.accountGeneration && a.connectionGeneration === b.connectionGeneration && a.physicalRef === b.physicalRef && a.ownerRef === b.ownerRef;

/** Preview only accepted history. Each row has a stable local record id, even
 * when the server supplied no message id. Bodies and unsent work are absent. */
export function previewHistoryEviction(owner: OwnerSnapshot, conversationId: ConversationId, rows: readonly EvictableHistoryRow[], retention: RetentionBounds, nowMs: number): { readonly removeRecordIds: readonly string[]; readonly cutoffMs: number | null } | null {
  if (!Number.isInteger(retention.keep) || retention.keep < 1 || retention.keep > 400
    || (retention.ephemeralSeconds !== null && (!Number.isSafeInteger(retention.ephemeralSeconds) || retention.ephemeralSeconds < 60 || retention.ephemeralSeconds > 2_592_000))
    || !Number.isSafeInteger(nowMs) || nowMs < 0) return null;
  const relevant = rows.filter((row) => sameOwner(row.owner, owner) && row.conversationId === conversationId && row.accepted && Number.isSafeInteger(row.atMs) && typeof row.recordId === 'string' && row.recordId.length > 0 && row.recordId.length <= 512);
  const ordered = relevant.slice().sort((a, b) => b.atMs - a.atMs || b.recordId.localeCompare(a.recordId));
  const cutoffMs = retention.ephemeralSeconds === null ? null : nowMs - retention.ephemeralSeconds * 1000;
  const removeRecordIds: string[] = [];
  for (const [index, row] of ordered.entries()) if (index >= retention.keep || (cutoffMs !== null && row.atMs < cutoffMs)) removeRecordIds.push(row.recordId);
  return { removeRecordIds, cutoffMs };
}

export interface EvictionDependencies {
  readonly namespaceForRequest: (request: RequestContext) => LocalNamespaceTicket | null;
  readonly isNamespaceCurrent: (ticket: LocalNamespaceTicket, request: RequestContext) => boolean;
  readonly readAcceptedHistory: (request: RequestContext, ticket: LocalNamespaceTicket, conversationId: ConversationId, maximum: number) => Promise<readonly EvictableHistoryRow[]>;
  readonly retentionPolicy: (request: RequestContext, ticket: LocalNamespaceTicket, conversationId: ConversationId) => { readonly revision: string; readonly bounds: RetentionBounds } | null;
  readonly clearAccepted: (request: RequestContext, ticket: LocalNamespaceTicket, conversationId: ConversationId, recordIds: readonly string[]) => Promise<number | null>;
  readonly now?: () => number;
}
export function createEvictionPolicy(deps: EvictionDependencies) {
  const now = deps.now ?? Date.now;
  const issued = new WeakMap<EvictionPreview, { readonly request: RequestContext; readonly ticket: LocalNamespaceTicket; readonly conversationId: ConversationId; readonly revision: string; readonly recordIds: readonly string[] }>();
  return {
    async preview(request: RequestContext & { readonly conversationId: ConversationId }): Promise<EvictionPreview | null> {
      const owner = request.owner;
      const ticket = deps.namespaceForRequest(request);
      if (!ticket || !deps.isNamespaceCurrent(ticket, request)) return null;
      if (ticket.scope.kind !== 'account') return null;
      const policy = deps.retentionPolicy(request, ticket, request.conversationId);
      if (!policy || !policy.revision || !Number.isInteger(policy.bounds.keep)) return null;
      const rows = await deps.readAcceptedHistory(request, ticket, request.conversationId, 16_384);
      const currentPolicy = deps.retentionPolicy(request, ticket, request.conversationId);
      if (!deps.isNamespaceCurrent(ticket, request) || currentPolicy?.revision !== policy.revision || rows.length > 16_384) return null;
      const decision = previewHistoryEviction(owner, request.conversationId, rows, policy.bounds, now());
      if (!decision) return null;
      const view = Object.freeze({ ownerRef: owner.ownerRef, conversationId: request.conversationId, count: decision.removeRecordIds.length, cutoffMs: decision.cutoffMs });
      issued.set(view, { request: Object.freeze({ ...request, owner: Object.freeze({ ...owner }) }), ticket, conversationId: request.conversationId, revision: policy.revision, recordIds: decision.removeRecordIds });
      return view;
    },
    async apply(request: RequestContext, preview: EvictionPreview): Promise<{ readonly status: 'cleared' | 'stale-owner' | 'invalid'; readonly affected: number }> {
      const owner = request.owner;
      const sealed = issued.get(preview);
      if (!sealed || !deps.isNamespaceCurrent(sealed.ticket, request) || !sameOwner(sealed.request.owner, owner) || sealed.request.requestId !== request.requestId) return { status: 'stale-owner', affected: 0 };
      if (preview.ownerRef !== owner.ownerRef || preview.conversationId !== sealed.conversationId || preview.count !== sealed.recordIds.length || deps.retentionPolicy(request, sealed.ticket, sealed.conversationId)?.revision !== sealed.revision) return { status: 'invalid', affected: 0 };
      if (!deps.isNamespaceCurrent(sealed.ticket, request)) return { status: 'stale-owner', affected: 0 };
      const affected = await deps.clearAccepted(request, sealed.ticket, sealed.conversationId, sealed.recordIds);
      issued.delete(preview);
      if (affected === null) return { status: deps.isNamespaceCurrent(sealed.ticket, request) ? 'invalid' : 'stale-owner', affected: 0 };
      return deps.isNamespaceCurrent(sealed.ticket, request) ? { status: 'cleared', affected } : { status: 'stale-owner', affected: 0 };
    },
  };
}
