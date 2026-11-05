import type { ConversationId, OwnerSnapshot, RequestContext } from './contracts';
import type { LocalNamespaceTicket, LocalWorkspaceScope } from './local-workspace-owner';

export interface DraftRecoveryMetadata {
  readonly draftRef: string;
  readonly conversationId: ConversationId;
  readonly revision: number;
  readonly updatedAtMs: number;
  readonly ciphertextBytes: number;
}

export interface DraftRecoveryRecord {
  readonly rowId: string;
  readonly ownerKey: string;
  readonly targetKey: string;
  readonly conversationId: ConversationId;
  readonly revision: number;
  readonly updatedAtMs: number;
  readonly ciphertextBytes: number;
}

export interface DraftRecoverySelection extends DraftRecoveryRecord {
  readonly context: RequestContext;
  readonly ticket: LocalNamespaceTicket;
  readonly draftRef: string;
}

export interface PrivateDraftSelectionDependencies {
  readonly isCurrent: (owner: OwnerSnapshot) => boolean;
  readonly isNamespaceCurrent: (ticket: LocalNamespaceTicket, context: RequestContext) => boolean;
  readonly now: () => number;
  readonly randomRef: () => string;
}

interface SelectionEntry {
  readonly context: RequestContext;
  readonly ticket: LocalNamespaceTicket;
  readonly record: DraftRecoveryRecord;
  readonly expiresAt: number;
}

const MAX_SELECTIONS = 100;
const MAX_REF_LENGTH = 128;
const SAFE_REF = /^[A-Za-z0-9_-]{22,128}$/u;

function sameOwner(a: OwnerSnapshot, b: OwnerSnapshot): boolean {
  return a.networkId === b.networkId && a.accountId === b.accountId
    && a.accountGeneration === b.accountGeneration && a.connectionGeneration === b.connectionGeneration
    && a.physicalRef === b.physicalRef && a.ownerRef === b.ownerRef;
}

function sameNamespace(a: LocalNamespaceTicket, b: LocalNamespaceTicket): boolean {
  return a.scope === b.scope && a.workspaceEpoch === b.workspaceEpoch && a.ownerKey === b.ownerKey
    && a.access === b.access && a.scope.workspaceRef === b.scope.workspaceRef
    && a.scope.networkId === b.scope.networkId && a.scope.accountId === b.scope.accountId
    && a.scope.localWorkspaceEpoch === b.scope.localWorkspaceEpoch
    && a.conversationScheme?.name === b.conversationScheme?.name
    && a.conversationScheme?.revision === b.conversationScheme?.revision;
}

function validRecord(value: DraftRecoveryRecord, ticket: LocalNamespaceTicket): boolean {
  return typeof value.rowId === 'string' && value.rowId.length > 0 && value.rowId.length <= 1024
    && value.ownerKey === ticket.ownerKey && typeof value.targetKey === 'string' && value.targetKey.length > 0 && value.targetKey.length <= 512
    && typeof value.conversationId === 'string' && value.conversationId.length > 0 && value.conversationId.length <= 512
    && Number.isSafeInteger(value.revision) && value.revision >= 0
    && Number.isSafeInteger(value.updatedAtMs) && value.updatedAtMs >= 0
    && Number.isSafeInteger(value.ciphertextBytes) && value.ciphertextBytes >= 0 && value.ciphertextBytes <= 66 * 1024;
}

/**
 * One-use metadata capabilities for explicit recovery from the currently
 * selected local workspace. These refs carry no ciphertext or plaintext.
 */
export function createPrivateDraftSelection(deps: PrivateDraftSelectionDependencies) {
  const entries = new Map<string, SelectionEntry>();
  let disposed = false;

  function current(context: RequestContext, ticket: LocalNamespaceTicket): boolean {
    return !disposed && context.schemaVersion === 1 && deps.isCurrent(context.owner)
      && deps.isNamespaceCurrent(ticket, context);
  }

  function replace(context: RequestContext, ticket: LocalNamespaceTicket, records: readonly DraftRecoveryRecord[]): readonly DraftRecoveryMetadata[] | null {
    if (!current(context, ticket)) return null;
    entries.clear();
    if (records.length > MAX_SELECTIONS || records.some((record) => !validRecord(record, ticket))) return null;
    const output: DraftRecoveryMetadata[] = [];
    const created: Array<[string, SelectionEntry]> = [];
    for (const record of records) {
      let draftRef = '';
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const candidate = deps.randomRef();
        if (candidate.length <= MAX_REF_LENGTH && SAFE_REF.test(candidate) && !entries.has(candidate) && !created.some(([key]) => key === candidate)) {
          draftRef = candidate;
          break;
        }
      }
      if (!draftRef) {
        entries.clear();
        return null;
      }
      const capturedContext = Object.freeze({ ...context, owner: Object.freeze({ ...context.owner }) });
      // LocalNamespaceTicket is an issued capability. Some owners keep its
      // provenance in a WeakMap, so copying its fields silently loses the
      // authority this selection is meant to capture.
      const capturedTicket = ticket;
      const capturedRecord = Object.freeze({ ...record });
      created.push([draftRef, { context: capturedContext, ticket: capturedTicket, record: capturedRecord, expiresAt: deps.now() + 60_000 }]);
      output.push(Object.freeze({ draftRef, conversationId: record.conversationId, revision: record.revision, updatedAtMs: record.updatedAtMs, ciphertextBytes: record.ciphertextBytes }));
    }
    for (const [ref, entry] of created) entries.set(ref, entry);
    return Object.freeze(output);
  }

  function consume(context: RequestContext, ticket: LocalNamespaceTicket, draftRef: string): DraftRecoverySelection | null {
    if (!current(context, ticket) || !SAFE_REF.test(draftRef)) return null;
    const entry = entries.get(draftRef);
    if (!entry) return null;
    entries.delete(draftRef);
    if (entry.expiresAt <= deps.now() || !sameOwner(entry.context.owner, context.owner)
      || !sameNamespace(entry.ticket, ticket) || !current(entry.context, entry.ticket) || !current(context, ticket)) return null;
    return Object.freeze({ ...entry.record, context: Object.freeze({ ...context, owner: Object.freeze({ ...context.owner }) }), ticket, draftRef });
  }

  function retireOwner(owner: OwnerSnapshot): void {
    for (const [ref, entry] of entries) if (sameOwner(entry.context.owner, owner)) entries.delete(ref);
  }

  function retireScope(scope: LocalWorkspaceScope): void {
    for (const [ref, entry] of entries) {
      if (entry.ticket.scope === scope || (entry.ticket.scope.workspaceRef === scope.workspaceRef
        && entry.ticket.scope.localWorkspaceEpoch === scope.localWorkspaceEpoch
        && entry.ticket.scope.networkId === scope.networkId && entry.ticket.scope.accountId === scope.accountId)) entries.delete(ref);
    }
  }

  return {
    replace,
    consume,
    retireOwner,
    retireScope,
    dispose(): void { disposed = true; entries.clear(); },
  };
}
