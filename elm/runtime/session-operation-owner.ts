import type { OwnerSnapshot, RequestContext, RequestId } from './contracts';

export type SessionOperationKind = 'resume' | 'local-list' | 'local-drop' | 'mesh-list' | 'mesh-revoke' | 'token-issue';
export interface SessionOperationLease {
  readonly operationRef: symbol;
  readonly kind: SessionOperationKind;
  isCurrent(): boolean;
  markUnknown(): void;
  release(): void;
}

interface ActiveOperation {
  readonly context: RequestContext;
  readonly kind: SessionOperationKind;
  readonly operationRef: symbol;
  unknown: boolean;
  afterRelease: (() => void) | null;
  lease: SessionOperationLease;
}

function sameOwner(a: OwnerSnapshot, b: OwnerSnapshot): boolean {
  return a.networkId === b.networkId && a.accountId === b.accountId
    && a.accountGeneration === b.accountGeneration && a.connectionGeneration === b.connectionGeneration
    && a.physicalRef === b.physicalRef && a.ownerRef === b.ownerRef;
}

/** Serializes every SESSION command on one authenticated physical attachment.
 * An unknown write retains the barrier until matching reconciliation or owner
 * retirement; no public ref can mint or release a lease. */
export function createSessionOperationOwner(deps: {
  readonly currentOwner: () => OwnerSnapshot;
  readonly isCurrent: (owner: OwnerSnapshot) => boolean;
}): {
  acquire(context: RequestContext, kind: SessionOperationKind, operationRef?: symbol): SessionOperationLease | null;
  afterRelease(owner: OwnerSnapshot, operationRef: RequestId, callback: () => void): boolean;
  retire(owner: OwnerSnapshot): void;
  dispose(): void;
  currentKind(): SessionOperationKind | null;
  isUnknown(): boolean;
} {
  let active: ActiveOperation | null = null;
  let disposed = false;

  const current = (operation: ActiveOperation): boolean => !disposed && active === operation
    && sameOwner(operation.context.owner, deps.currentOwner()) && deps.isCurrent(operation.context.owner);

  const release = (operation: ActiveOperation): void => {
    if (active !== operation) return;
    active = null;
    const callback = operation.afterRelease;
    operation.afterRelease = null;
    if (callback && !disposed && sameOwner(operation.context.owner, deps.currentOwner()) && deps.isCurrent(operation.context.owner)) {
      try { callback(); } catch { /* queued private operation is isolated */ }
    }
  };

  return {
    acquire(context, kind, requestedOperationRef) {
      if (disposed || !context || context.schemaVersion !== 1 || !context.requestId || !context.owner
        || !sameOwner(context.owner, deps.currentOwner()) || !deps.isCurrent(context.owner)) return null;
      if (active) {
        // Only an explicit continuation of the same private operation may
        // reuse an unknown lease. It never admits a different SESSION command.
        return active.unknown && active.operationRef === requestedOperationRef && active.kind === kind
          && sameOwner(active.context.owner, context.owner) && current(active) ? active.lease : null;
      }
      const operationRef = requestedOperationRef ?? Symbol('session-operation');
      const operation: ActiveOperation = { context, kind, operationRef, unknown: false, afterRelease: null, lease: null as unknown as SessionOperationLease };
      let released = false;
      operation.lease = {
        operationRef,
        kind,
        isCurrent: () => !released && current(operation),
        markUnknown: () => { if (!released && current(operation)) operation.unknown = true; },
        release: () => { if (released) return; released = true; release(operation); },
      };
      active = operation;
      return operation.lease;
    },
    afterRelease(owner, operationRef, callback) {
      const operation = active;
      if (!operation || operation.context.requestId !== operationRef || !sameOwner(operation.context.owner, owner)
        || !current(operation) || operation.afterRelease !== null) return false;
      operation.afterRelease = callback;
      return true;
    },
    retire(owner) {
      const operation = active;
      if (!operation || !sameOwner(operation.context.owner, owner)) return;
      operation.afterRelease = null;
      active = null;
    },
    dispose() {
      disposed = true;
      if (active) active.afterRelease = null;
      active = null;
    },
    currentKind: () => active?.kind ?? null,
    isUnknown: () => active?.unknown ?? false,
  };
}
