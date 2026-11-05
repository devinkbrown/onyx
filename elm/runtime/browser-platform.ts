// SPDX-License-Identifier: AGPL-3.0-or-later
import type { BuildCompatibility } from './worker-lifecycle';
import type { OwnerSnapshot, RequestContext } from './contracts';

interface PendingNotificationRouteBase {
  readonly schemaVersion: 1;
  readonly routeRef: string;
  readonly claimRef: string;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
}
export type PendingNotificationRoute = PendingNotificationRouteBase & (
  | { readonly networkId: null; readonly accountId: null; readonly bindingRef: null; readonly kind: 'inbox'; readonly conversationId: null }
  | { readonly networkId: string; readonly accountId: string; readonly bindingRef: string; readonly kind: 'dm' | 'mention' | 'call'; readonly conversationId: string }
);
export type BrowserPlatform = ReturnType<typeof createBrowserPlatform>;

const STORAGE_SCHEMAS = Object.freeze({ vault: 5 as const, privateCrypto: 2 as const, platform: 1 as const, tabIntents: 1 as const, localWorkspaces: 1 as const });
const CONTROL = /[\u0000-\u001f\u007f]/u;
const HEX_REF = /^[a-f0-9]{64}$/u;
const UUID_REF = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const COMPATIBILITY_KEYS = ['buildId', 'protocolVersion', 'storageSchemas', 'shellAssets', 'publicNavigationPaths'] as const;

function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function exactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!record(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function safePath(path: unknown): path is string {
  return typeof path === 'string' && path.startsWith('/') && !path.startsWith('//') && !path.includes('\\')
    && !path.includes('?') && !path.includes('#') && !CONTROL.test(path) && !/%(?:2f|5c|00)/iu.test(path);
}
function normalizeCompatibility(value: unknown): BuildCompatibility | null {
  if (!exactKeys(value, COMPATIBILITY_KEYS) || typeof value.buildId !== 'string' || !/^[a-f0-9]{32}$/u.test(value.buildId)
    || value.protocolVersion !== 1 || !exactKeys(value.storageSchemas, Object.keys(STORAGE_SCHEMAS))) return null;
  const schemas = value.storageSchemas;
  if (schemas.vault !== 5 || schemas.privateCrypto !== 2 || schemas.platform !== 1 || schemas.tabIntents !== 1 || schemas.localWorkspaces !== 1
    || !Array.isArray(value.shellAssets) || value.shellAssets.length < 1 || value.shellAssets.length > 256
    || !Array.isArray(value.publicNavigationPaths) || value.publicNavigationPaths.length < 1 || value.publicNavigationPaths.length > 256) return null;
  const assets: Array<{ path: string; sha256: string }> = [];
  const paths = new Set<string>();
  for (const asset of value.shellAssets) {
    if (!exactKeys(asset, ['path', 'sha256']) || !safePath(asset.path) || typeof asset.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(asset.sha256)
      || paths.has(asset.path)) return null;
    paths.add(asset.path);
    assets.push({ path: asset.path, sha256: asset.sha256 });
  }
  const navigation = new Set<string>();
  for (const path of value.publicNavigationPaths) {
    if (!safePath(path) || navigation.has(path) || !paths.has(path)) return null;
    navigation.add(path);
  }
  return Object.freeze({ buildId: value.buildId, protocolVersion: 1, storageSchemas: STORAGE_SCHEMAS,
    shellAssets: Object.freeze(assets.map((asset) => Object.freeze(asset))), publicNavigationPaths: Object.freeze([...navigation]) });
}

function validJsonWithoutDuplicateKeys(source: string): boolean {
  const stack: Array<{ kind: 'object' | 'array'; keys: Set<string>; expectKey: boolean }> = [];
  let string = false; let escaped = false; let token = '';
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    if (string) {
      if (escaped) { escaped = false; token += char; continue; }
      if (char === '\\') { escaped = true; token += char; continue; }
      if (char === '"') {
        string = false;
        const parent = stack.at(-1);
        if (parent?.kind === 'object' && parent.expectKey) {
          let key: unknown;
          try { key = JSON.parse(`"${token}"`); } catch { return false; }
          if (typeof key !== 'string' || parent.keys.has(key)) return false;
          parent.keys.add(key); parent.expectKey = false;
        }
        token = '';
        continue;
      }
      token += char;
      continue;
    }
    if (char === '"') { string = true; token = ''; continue; }
    if (char === '{') { stack.push({ kind: 'object', keys: new Set(), expectKey: true }); continue; }
    if (char === '[') { stack.push({ kind: 'array', keys: new Set(), expectKey: false }); continue; }
    if (char === '}' || char === ']') {
      const parent = stack.pop();
      if (!parent || char === '}' !== (parent.kind === 'object')) return false;
      continue;
    }
    if (char === ',' && stack.at(-1)?.kind === 'object') stack.at(-1)!.expectKey = true;
  }
  return !string && stack.length === 0;
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (): boolean => {
      if (settled) return false;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      return true;
    };
    const onAbort = (): void => { if (finish()) reject(new Error('metadata-timeout')); };
    if (signal.aborted) { reject(new Error('metadata-timeout')); return; }
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(value => { if (finish()) resolve(value); }, error => { if (finish()) reject(error); });
  });
}

async function readWithAbort(reader: ReadableStreamDefaultReader<Uint8Array>, signal: AbortSignal): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (signal.aborted) { await reader.cancel(); throw new Error('metadata-timeout'); }
  const read = reader.read();
  try { return await abortable(read, signal); }
  catch (error) { if (signal.aborted) void reader.cancel().catch(() => {}); throw error; }
}

async function boundedResponseText(response: Response, maxBytes: number, signal: AbortSignal): Promise<string | null> {
  if (!response.body) {
    try {
      const text = await abortable(response.text(), signal);
      return new TextEncoder().encode(text).byteLength <= maxBytes ? text : null;
    } catch { return null; }
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const chunk = await readWithAbort(reader, signal);
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > maxBytes) { await reader.cancel(); return null; }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(total); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch { try { await reader.cancel(); } catch { /* stream already closed */ } return null; }
}

export async function loadBrowserBuildCompatibility(input: {
  readonly fetch: typeof fetch;
  readonly origin: string;
  readonly expectedShellRef: string;
  readonly runtimeShellRef: string;
}): Promise<BuildCompatibility | null> {
  if (!HEX_REF.test(input.expectedShellRef) || input.runtimeShellRef !== input.expectedShellRef) return null;
  let origin: string;
  try { origin = new URL(input.origin).origin; } catch { return null; }
  if (origin !== input.origin || !/^https?:\/\//u.test(origin)) return null;
  const url = new URL('/runtime-build.json', origin);
  let response: Response;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const load = async (): Promise<BuildCompatibility | null> => {
      response = await input.fetch(url.href, { method: 'GET', mode: 'same-origin', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal });
      if (!response.ok) return null;
      try { if (response.url && new URL(response.url).origin !== origin) return null; } catch { return null; }
      const length = Number(response.headers.get('content-length'));
      if (Number.isFinite(length) && length > 1024 * 1024) return null;
      const text = await boundedResponseText(response, 1024 * 1024, controller.signal);
      if (text === null || !validJsonWithoutDuplicateKeys(text)) return null;
      let envelope: unknown;
      try { envelope = JSON.parse(text); } catch { return null; }
      if (!exactKeys(envelope, ['shellRef', 'buildCompatibility']) || envelope.shellRef !== input.expectedShellRef) return null;
      return normalizeCompatibility(envelope.buildCompatibility);
    };
    return await Promise.race([
      load(),
      new Promise<null>((resolve) => { timer = setTimeout(() => { controller.abort(); resolve(null); }, 2500); }),
    ]);
  } catch { return null; }
  finally { if (timer !== undefined) clearTimeout(timer); }
}

function sameOwner(a: OwnerSnapshot, b: OwnerSnapshot): boolean {
  return a.networkId === b.networkId && a.accountId === b.accountId && a.accountGeneration === b.accountGeneration
    && a.connectionGeneration === b.connectionGeneration && a.physicalRef === b.physicalRef && a.ownerRef === b.ownerRef;
}
function validRoute(value: unknown): value is PendingNotificationRoute {
  const createdAtMs = record(value) && typeof value.createdAtMs === 'number' ? value.createdAtMs : NaN;
  const expiresAtMs = record(value) && typeof value.expiresAtMs === 'number' ? value.expiresAtMs : NaN;
  if (!exactKeys(value, ['schemaVersion', 'routeRef', 'claimRef', 'networkId', 'accountId', 'bindingRef', 'kind', 'conversationId', 'createdAtMs', 'expiresAtMs'])
    || value.schemaVersion !== 1 || typeof value.routeRef !== 'string' || !UUID_REF.test(value.routeRef)
    || typeof value.claimRef !== 'string' || !UUID_REF.test(value.claimRef)
    || !['inbox', 'dm', 'mention', 'call'].includes(String(value.kind))
    || !Number.isSafeInteger(createdAtMs) || !Number.isSafeInteger(expiresAtMs)
    || expiresAtMs <= createdAtMs || expiresAtMs - createdAtMs > 10 * 60_000) return false;
  if (value.kind === 'inbox') return value.networkId === null && value.accountId === null && value.bindingRef === null && value.conversationId === null;
  if (typeof value.networkId !== 'string' || value.networkId.length < 1 || value.networkId.length > 128 || CONTROL.test(value.networkId)
    || typeof value.accountId !== 'string' || value.accountId.length < 1 || value.accountId.length > 128 || CONTROL.test(value.accountId)
    || typeof value.bindingRef !== 'string' || !UUID_REF.test(value.bindingRef)
    || typeof value.conversationId !== 'string' || value.conversationId.length < 1 || value.conversationId.length > 256 || CONTROL.test(value.conversationId)) return false;
  return true;
}

function requestWorker<T>(controller: ServiceWorker, message: Record<string, unknown>, timeoutMs = 5000): Promise<T | null> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => { channel.port1.close(); channel.port2.close(); resolve(null); }, timeoutMs);
    channel.port1.onmessage = (event: MessageEvent<unknown>) => {
      clearTimeout(timer);
      channel.port1.close(); channel.port2.close();
      resolve(record(event.data) ? event.data as T : null);
    };
    try { controller.postMessage(message, [channel.port2]); }
    catch { clearTimeout(timer); channel.port1.close(); channel.port2.close(); resolve(null); }
  });
}

export function createBrowserPlatform(input: {
  readonly serviceWorker: ServiceWorkerContainer | null;
  readonly applicationOrigin: string;
  readonly allowedPaths: readonly string[];
  readonly getCurrentOwner: () => OwnerSnapshot;
  readonly isCurrent: (owner: OwnerSnapshot) => boolean;
  readonly now: () => number;
}) {
  let disposed = false;
  let freezeToken: symbol | null = null;
  let freezeRelease: (() => void) | null = null;
  let ownedFreezeStatus: HTMLElement | null = null;
  let compositionActive = false;
  const compositionStart = (): void => { compositionActive = true; };
  const compositionEnd = (): void => { compositionActive = false; };
  if (typeof document !== 'undefined') {
    document.addEventListener('compositionstart', compositionStart, true);
    document.addEventListener('compositionend', compositionEnd, true);
  }
  const clientPathOkay = (): boolean => {
    try {
      const here = new URL(window.location.href);
      return here.origin === input.applicationOrigin && input.allowedPaths.includes(here.pathname)
        && !!navigator.serviceWorker?.controller;
    } catch { return false; }
  };
  const claimNotificationRoute = async (context: RequestContext): Promise<PendingNotificationRoute | null> => {
    if (disposed || !clientPathOkay() || !input.isCurrent(context.owner)
      || !sameOwner(context.owner, input.getCurrentOwner())) return null;
    const controller = input.serviceWorker?.controller;
    if (!controller) return null;
    const reply = await requestWorker<Record<string, unknown>>(controller, {
      schemaVersion: 1, type: 'CLAIM_NOTIFICATION_ROUTE', requestId: context.requestId,
      networkId: context.owner.networkId, accountId: context.owner.accountId,
    });
    if (disposed || !input.isCurrent(context.owner) || !sameOwner(context.owner, input.getCurrentOwner())
      || !reply || reply.schemaVersion !== 1 || reply.type !== 'NOTIFICATION_ROUTE_CLAIM_RESULT'
      || reply.requestId !== context.requestId || reply.status !== 'claimed' || reply.route === null) return null;
    const route = reply.route;
    if (!validRoute(route) || (route.kind !== 'inbox' && (route.networkId !== context.owner.networkId || route.accountId !== context.owner.accountId))
      || route.expiresAtMs <= input.now()) return null;
    return Object.freeze({ ...route });
  };
  const settleNotificationRoute = async (context: RequestContext, route: Pick<PendingNotificationRoute, 'routeRef' | 'claimRef'> & { readonly outcome: 'opened' | 'authentication-required' | 'unavailable' }): Promise<boolean> => {
    if (disposed || !clientPathOkay() || !input.isCurrent(context.owner) || !sameOwner(context.owner, input.getCurrentOwner())) return false;
    const controller = input.serviceWorker?.controller;
    if (!controller) return false;
    const reply = await requestWorker<Record<string, unknown>>(controller, {
      schemaVersion: 1, type: 'SETTLE_NOTIFICATION_ROUTE', requestId: context.requestId,
      routeRef: route.routeRef, claimRef: route.claimRef, outcome: route.outcome,
    });
    return !disposed && !!reply && reply.schemaVersion === 1 && reply.type === 'NOTIFICATION_ROUTE_SETTLE_RESULT'
      && reply.requestId === context.requestId && reply.status === 'settled'
      && input.isCurrent(context.owner) && sameOwner(context.owner, input.getCurrentOwner());
  };
  const freezeAuthoring = (targetBuildId: string, requestId: string, owner: OwnerSnapshot): (() => void) | null => {
    if (disposed || typeof document === 'undefined' || compositionActive || !/^[a-f0-9]{32}$/u.test(targetBuildId)
      || !requestId || requestId.length > 128 || !input.isCurrent(owner) || !sameOwner(owner, input.getCurrentOwner())) return null;
    const root = document.getElementById('app');
    if (!root || freezeToken) return null;
    let status = document.getElementById('onyx-platform-update-status');
    let createdStatus = false;
    if (!status) {
      if (!document.body) return null;
      status = document.createElement('div');
      status.id = 'onyx-platform-update-status';
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      status.className = 'sr-only';
      document.body.append(status);
      createdStatus = true;
      ownedFreezeStatus = status;
    }
    const previousStatus = status.textContent;
    const token = Symbol('platform-update-freeze');
    freezeToken = token;
    const wasInert = root.inert;
    const blockInput = (event: Event): void => { if (event.composedPath().includes(root)) event.preventDefault(); };
    root.inert = true;
    document.addEventListener('beforeinput', blockInput, true);
    document.addEventListener('paste', blockInput, true);
    document.addEventListener('drop', blockInput, true);
    status.textContent = 'Updating Onyx. Your current work is protected.';
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      document.removeEventListener('beforeinput', blockInput, true);
      document.removeEventListener('paste', blockInput, true);
      document.removeEventListener('drop', blockInput, true);
      if (freezeToken === token) {
        root.inert = wasInert; freezeToken = null; freezeRelease = null;
        if (createdStatus) {
          status.remove();
          if (ownedFreezeStatus === status) ownedFreezeStatus = null;
        } else status.textContent = previousStatus;
      }
    };
    freezeRelease = release;
    return release;
  };
  return Object.freeze({ claimNotificationRoute, settleNotificationRoute, freezeAuthoring,
    dispose(): void {
      disposed = true; freezeRelease?.(); freezeRelease = null; freezeToken = null;
      ownedFreezeStatus?.remove(); ownedFreezeStatus = null;
      if (typeof document !== 'undefined') {
        document.removeEventListener('compositionstart', compositionStart, true);
        document.removeEventListener('compositionend', compositionEnd, true);
      }
    } });
}
