// SPDX-License-Identifier: AGPL-3.0-or-later
import type { OwnerSnapshot, RequestContext, RequestId, RuntimeFactoryContext } from './contracts';

export type WorkerStatusKind = 'unsupported' | 'unregistered' | 'installing' | 'waiting' | 'blocked-by-clients' | 'activating' | 'ready' | 'failed';
export type WorkerReason = 'api-unavailable' | 'registration-failed' | 'version-mismatch' | 'client-not-ready' | 'activation-failed' | 'stale-owner' | 'unknown-clients' | null;
export interface ClientActivationState {
  readonly clientRef: string;
  readonly buildId: string;
  readonly protocolVersion: 1;
  readonly storageSchemas: StorageSchemaTuple;
  readonly hasUnsavedDraft: boolean;
  readonly activeCall: boolean;
  readonly pendingPrivateMutation: boolean;
  readonly canActivate: boolean;
}
export interface BuildCompatibility {
  readonly buildId: string;
  readonly protocolVersion: 1;
  readonly storageSchemas: StorageSchemaTuple;
  readonly shellAssets: readonly { readonly path: string; readonly sha256: string }[];
  readonly publicNavigationPaths: readonly string[];
}
export interface StorageSchemaTuple { readonly vault: 5; readonly privateCrypto: 2; readonly platform: 1; readonly tabIntents: 1; readonly localWorkspaces: 1 }
const EXPECTED_SCHEMAS: StorageSchemaTuple = { vault: 5, privateCrypto: 2, platform: 1, tabIntents: 1, localWorkspaces: 1 };
export interface ActivationIntent extends RequestContext { readonly targetBuildId: string; readonly action: 'when-safe' | 'cancel' }
export interface WorkerStatus extends RequestContext {
  readonly status: WorkerStatusKind;
  readonly reason: WorkerReason;
  readonly pendingClientCount: number;
  readonly buildId: string;
}
export type ActivationResult = WorkerStatus;
export interface WorkerLifecycleDependencies extends Pick<RuntimeFactoryContext, 'ownerSnapshot' | 'isCurrent' | 'platform'> {
  readonly currentClientRef: string;
  readonly acquireActivationLease: (input: { readonly targetBuildId: string; readonly requestId: RequestId }) => Promise<(() => void) | null>;
  readonly timeoutMs?: number;
}

const SCHEMA = 1 as const;
const CLIENT_STATE = 'CLIENT_STATE';
const STATE_REQUEST = 'STATE_REQUEST';
const REQUEST_ACTIVATION = 'REQUEST_ACTIVATION';
const CANCEL_ACTIVATION = 'CANCEL_ACTIVATION';
const HELLO = 'HELLO';

function sameOwner(a: OwnerSnapshot, b: OwnerSnapshot): boolean {
  return a.ownerRef === b.ownerRef && a.networkId === b.networkId && a.accountId === b.accountId && a.accountGeneration === b.accountGeneration && a.connectionGeneration === b.connectionGeneration;
}
function validState(value: unknown): value is ClientActivationState {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<ClientActivationState>;
  return typeof v.clientRef === 'string' && v.clientRef.length > 0 && v.clientRef.length <= 256
    && typeof v.buildId === 'string' && v.buildId.length > 0 && v.buildId.length <= 128
    && v.protocolVersion === 1 && sameSchemas(v.storageSchemas)
    && typeof v.hasUnsavedDraft === 'boolean' && typeof v.activeCall === 'boolean'
    && typeof v.pendingPrivateMutation === 'boolean' && typeof v.canActivate === 'boolean';
}
function sameSchemas(value: unknown): value is StorageSchemaTuple {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === 'localWorkspaces,platform,privateCrypto,tabIntents,vault'
    && (value as StorageSchemaTuple).vault === EXPECTED_SCHEMAS.vault
    && (value as StorageSchemaTuple).privateCrypto === EXPECTED_SCHEMAS.privateCrypto
    && (value as StorageSchemaTuple).platform === EXPECTED_SCHEMAS.platform
    && (value as StorageSchemaTuple).tabIntents === EXPECTED_SCHEMAS.tabIntents
    && (value as StorageSchemaTuple).localWorkspaces === EXPECTED_SCHEMAS.localWorkspaces;
}

/** The waiting worker, not one tab's local view, evaluates every live client. */
export function createWorkerLifecycle(deps: WorkerLifecycleDependencies): {
  register(req: RequestContext): Promise<WorkerStatus>;
  reportClientState(state: ClientActivationState): void;
  requestActivation(req: ActivationIntent): Promise<ActivationResult>;
  dispose(): void;
} {
  const serviceWorker = deps.platform.serviceWorker;
  const build = deps.platform.build;
  const timeoutMs = Math.max(250, Math.min(deps.timeoutMs ?? 5000, 15000));
  let registration: ServiceWorkerRegistration | null = null;
  let waitingBuildId: string | null = null;
  let localState: ClientActivationState | null = null;
  let disposed = false;
  const pending = new Set<() => void>();
  let releaseLease: (() => void) | null = null;
  let leaseAcquisition: Promise<boolean> | null = null;
  let leaseJob: string | null = null;
  let leaseId: string | null = null;
  let leaseValidUntil = 0;
  let leaseTargetBuildId: string | null = null;
  let leaseWorker: ServiceWorker | null = null;
  const status = (req: RequestContext, kind: WorkerStatusKind, reason: WorkerReason = null, count = 0): WorkerStatus => ({
    schemaVersion: SCHEMA, requestId: req.requestId, owner: req.owner, status: kind, reason, pendingClientCount: count, buildId: build.buildId,
  });
  const isCurrent = (req: RequestContext) => !disposed && sameOwner(deps.ownerSnapshot(), req.owner) && deps.isCurrent(req.owner);
  const post = (worker: ServiceWorker | null, message: Record<string, unknown>, port?: MessagePort) => {
    if (!worker) return false;
    try { worker.postMessage({ schemaVersion: SCHEMA, ...message }, port ? [port] : []); return true; } catch { port?.close(); return false; }
  };
  const acquireLease = async (targetBuildId: string, requestId: RequestId): Promise<boolean> => {
    if (disposed) return false;
    const job = `${targetBuildId}:${requestId}`;
    if (releaseLease) return leaseJob === job;
    if (leaseAcquisition) return leaseAcquisition;
    const generationAtStart = deps.ownerSnapshot();
    leaseAcquisition = (async () => {
      const release = await deps.acquireActivationLease({ targetBuildId, requestId }).catch(() => null);
      if (!release) return false;
      if (disposed || !sameOwner(generationAtStart, deps.ownerSnapshot()) || !deps.isCurrent(generationAtStart)) { release(); return false; }
      releaseLease = release;
      leaseJob = job;
      leaseId = globalThis.crypto.randomUUID();
      leaseValidUntil = Date.now() + Math.min(timeoutMs * 4, 20_000);
      leaseTargetBuildId = targetBuildId;
      return true;
    })();
    try { return await leaseAcquisition; }
    finally { leaseAcquisition = null; }
  };
  const respondToStateRequest = (event: MessageEvent): void => {
    const data = event.data;
    const port = event.ports[0];
    if (!port || !data || typeof data !== 'object' || data.schemaVersion !== SCHEMA || data.type !== STATE_REQUEST
      || typeof data.requestId !== 'string' || data.requestId.length < 16 || data.requestId.length > 128
      || typeof data.targetBuildId !== 'string' || data.targetBuildId.length > 128) { port?.close(); return; }
    if (event.source !== registration?.waiting && event.source !== registration?.installing && event.source !== registration?.active && event.source !== serviceWorker?.controller) { port.close(); return; }
    void (async () => {
      try {
        let leaseAcquired = await acquireLease(data.targetBuildId as string, data.requestId as RequestId);
        leaseAcquired = leaseAcquired && leaseJob === `${data.targetBuildId}:${data.requestId}`;
        if (leaseAcquired) {
          if (leaseWorker && leaseWorker !== event.source) leaseAcquired = false;
          else leaseWorker = event.source as ServiceWorker;
        }
        if (disposed) return;
        const state = localState;
        const safeState = state && state.clientRef === deps.currentClientRef
          ? { ...state, canActivate: state.canActivate && leaseAcquired }
          : null;
        if (safeState && leaseAcquired && leaseId && leaseJob === `${data.targetBuildId}:${data.requestId}` && Date.now() < leaseValidUntil) {
          port.postMessage({ schemaVersion: SCHEMA, type: CLIENT_STATE, requestId: data.requestId, state: safeState, lease: { id: leaseId, validUntil: leaseValidUntil } });
        } else port.postMessage({ schemaVersion: SCHEMA, type: CLIENT_STATE, requestId: data.requestId, state: safeState, lease: null });
      } catch { /* fail closed: worker times out and blocks activation */ }
      finally { port.close(); }
    })();
  };
  const releaseOnWorkerStatus = (event: MessageEvent): void => {
    const value = event.data;
    if (!value || value.schemaVersion !== SCHEMA || value.type !== 'STATUS'
      || event.source !== leaseWorker
      || typeof value.buildId !== 'string' || value.buildId !== leaseTargetBuildId
      || typeof value.requestId !== 'string' || !leaseJob || leaseJob !== `${value.targetBuildId}:${value.requestId}`
      || value.targetBuildId !== leaseTargetBuildId) return;
    if (!['blocked-by-clients', 'cancelled', 'failed', 'ready'].includes(value.status)) return;
    releaseLease?.(); releaseLease = null;
    leaseJob = null; leaseId = null; leaseValidUntil = 0; leaseTargetBuildId = null; leaseWorker = null;
  };
  const releaseOnControllerChange = () => {
    if (!leaseWorker || serviceWorker?.controller !== leaseWorker || leaseWorker.state !== 'activated') return;
    releaseLease?.(); releaseLease = null;
    leaseJob = null; leaseId = null; leaseValidUntil = 0; leaseTargetBuildId = null; leaseWorker = null;
  };
  serviceWorker?.addEventListener('message', respondToStateRequest);
  serviceWorker?.addEventListener('message', releaseOnWorkerStatus);
  serviceWorker?.addEventListener('controllerchange', releaseOnControllerChange);

  const reportClientState = (state: ClientActivationState): void => {
    if (disposed || !validState(state) || state.clientRef !== deps.currentClientRef) return;
    localState = Object.freeze({ ...state });
    const worker = registration?.waiting ?? registration?.installing ?? serviceWorker?.controller ?? null;
    post(worker, { type: CLIENT_STATE, state: localState });
  };

  const register = async (req: RequestContext): Promise<WorkerStatus> => {
    if (!isCurrent(req)) return status(req, 'failed', 'stale-owner');
    if (!serviceWorker) return status(req, 'unsupported', 'api-unavailable');
    try {
      const result = await serviceWorker.register('/sw.js', { scope: '/' });
      if (!isCurrent(req)) return status(req, 'failed', 'stale-owner');
      registration = result;
      const worker = result.installing ?? result.waiting ?? result.active;
      if (!worker) return status(req, 'unregistered');
      const hello = new MessageChannel();
      const helloResponse = await new Promise<boolean>((resolve, reject) => {
        const timeout = setTimeout(() => { hello.port1.close(); hello.port2.close(); reject(new Error('worker handshake timeout')); }, timeoutMs);
        hello.port1.onmessage = event => {
          clearTimeout(timeout);
          const value = event.data;
          hello.port1.close(); hello.port2.close();
          const valid = !!value && value.schemaVersion === SCHEMA && value.type === 'STATUS' && value.status === 'ready'
            && typeof value.buildId === 'string' && value.buildId.length > 0 && value.buildId.length <= 128
            && value.protocolVersion === build.protocolVersion && sameSchemas(value.storageSchemas)
            && sameSchemas(build.storageSchemas);
          if (valid) waitingBuildId = value.buildId;
          resolve(valid);
        };
        if (!post(worker, { type: HELLO, buildCompatibility: build, clientRef: deps.currentClientRef, clientState: localState }, hello.port2)) reject(new Error('worker handshake failed'));
      });
      if (!helloResponse || !isCurrent(req)) return status(req, 'failed', 'version-mismatch');
      const kind: WorkerStatusKind = result.installing ? 'installing' : result.waiting ? 'waiting' : 'ready';
      return status(req, kind);
    } catch { return status(req, 'failed', 'registration-failed'); }
  };

  const requestActivation = async (req: ActivationIntent): Promise<ActivationResult> => {
    if (!isCurrent(req)) return status(req, 'failed', 'stale-owner');
    if (!serviceWorker) return status(req, 'unsupported', 'api-unavailable');
    if (!registration) {
      const registered = await register(req);
      if (registered.status === 'failed' || registered.status === 'unsupported') return registered;
    }
    if (!isCurrent(req)) return status(req, 'failed', 'stale-owner');
    const waiting = registration?.waiting;
    if (!waiting) return status(req, registration?.installing ? 'installing' : registration?.active ? 'ready' : 'unregistered');
    if (!waitingBuildId || req.targetBuildId !== waitingBuildId) return status(req, 'failed', 'version-mismatch');
    if (req.action === 'cancel') {
      post(waiting, { type: CANCEL_ACTIVATION, requestId: req.requestId, targetBuildId: req.targetBuildId });
      return status(req, 'waiting');
    }

    const channel = new MessageChannel();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let onControllerChange: (() => void) | null = null;
    let settled = false;
    let controllerChanged = false;
    let releaseAfterCleanup = false;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (onControllerChange) serviceWorker.removeEventListener('controllerchange', onControllerChange);
      onControllerChange = null;
      channel.port1.onmessage = null;
      channel.port1.close(); channel.port2.close();
      if (releaseAfterCleanup) { releaseLease?.(); releaseLease = null; leaseJob = null; }
      pending.delete(cleanup);
    };
    pending.add(cleanup);
    try {
    const controllerPromise = new Promise<void>((resolve) => {
        onControllerChange = () => {
          if (registration?.waiting !== waiting && waiting.state !== 'activated') return;
          if (serviceWorker.controller !== waiting) return;
          controllerChanged = true; releaseAfterCleanup = true; resolve();
        };
        serviceWorker.addEventListener('controllerchange', onControllerChange, { once: true });
      });
      const response = await new Promise<{ status: WorkerStatusKind; reason: WorkerReason; pendingClients: number }>((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('activation response timeout')), timeoutMs);
        channel.port1.onmessage = event => {
          if (settled) return;
          const value = event.data;
          const statuses = ['unsupported', 'unregistered', 'installing', 'waiting', 'blocked-by-clients', 'activating', 'ready', 'failed', 'cancelled'];
          if (!value || value.schemaVersion !== SCHEMA || value.requestId !== req.requestId || value.targetBuildId !== req.targetBuildId
            || value.buildId !== waitingBuildId || !Array.isArray(value.leaseIds) || !statuses.includes(value.status)) return;
          settled = true;
          if (timer) clearTimeout(timer);
          resolve({
            status: (value.status === 'cancelled' ? 'waiting' : value.status) as WorkerStatusKind,
            reason: value.reason === 'version-mismatch' || value.reason === 'client-not-ready' || value.reason === 'unknown-clients' ? value.reason : null,
            pendingClients: Number.isSafeInteger(value.pendingClients) && value.pendingClients >= 0 ? value.pendingClients : 0,
          });
        };
        if (!post(waiting, { type: REQUEST_ACTIVATION, requestId: req.requestId, targetBuildId: req.targetBuildId }, channel.port2)) reject(new Error('post failed'));
      });
      if (!isCurrent(req)) return status(req, 'failed', 'stale-owner');
      if (response.status !== 'activating') {
        releaseAfterCleanup = response.status === 'blocked-by-clients' || response.status === 'failed';
        return status(req, response.status, response.reason, response.pendingClients);
      }
      releaseAfterCleanup = false;
      await Promise.race([controllerPromise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('controller change timeout')), timeoutMs); })]);
      if (!controllerChanged || !isCurrent(req)) return status(req, 'failed', 'activation-failed');
      releaseAfterCleanup = true;
      return status(req, 'ready');
    } catch {
      post(waiting, { type: CANCEL_ACTIVATION, requestId: req.requestId, targetBuildId: req.targetBuildId });
      return isCurrent(req) ? status(req, 'blocked-by-clients', 'unknown-clients', 1) : status(req, 'failed', 'stale-owner');
    } finally { cleanup(); }
  };

  return {
    register, reportClientState, requestActivation,
    dispose() { if (disposed) return; disposed = true; for (const cleanup of [...pending]) cleanup(); releaseLease?.(); releaseLease = null; leaseJob = null; leaseId = null; leaseValidUntil = 0; leaseTargetBuildId = null; leaseWorker = null; serviceWorker?.removeEventListener('message', respondToStateRequest); serviceWorker?.removeEventListener('message', releaseOnWorkerStatus); serviceWorker?.removeEventListener('controllerchange', releaseOnControllerChange); localState = null; registration = null; },
  };
}
