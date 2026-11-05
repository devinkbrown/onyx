import { canonicalTupleKey, type AccountId, type EndpointId, type NetworkId, type OwnerSnapshot, type RequestContext } from './contracts';

export interface ContinuationMetadata {
  readonly continuationRef: string;
  readonly networkId: NetworkId;
  readonly accountId: AccountId;
  readonly issuerEndpointId: EndpointId;
  readonly expiresAtMs: number;
  readonly remembered: boolean;
  readonly usable: boolean;
}
export interface IdentityPrivateStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export type SessionTokenSaslResult = { readonly kind: 'ready'; readonly payload: Uint8Array }
  | { readonly kind: 'blocked'; readonly reason: 'invalid-ref' | 'stale-context' | 'wrong-network' | 'wrong-account' | 'wrong-issuer' | 'expired' | 'unavailable' };

export type PrivateIdentityRecordKind = 'account-session-token' | 'mac-key' | 'recovery-secret' | 'passkey-material' | 'account-security' | 'unknown-private';
export interface PrivateIdentityNotice {
  readonly kind: PrivateIdentityRecordKind;
  readonly available: boolean;
  readonly owner: OwnerSnapshot;
}

export interface IdentityOwnerDependencies {
  readonly ownerSnapshot: () => OwnerSnapshot;
  readonly isCurrent: (owner: OwnerSnapshot) => boolean;
  readonly now?: () => number;
  readonly onNotice?: (notice: PrivateIdentityNotice) => void;
  readonly onPrivateMediaRecord?: (line: string, owner: OwnerSnapshot) => void;
  readonly onPrivateAccountLine?: (line: string, owner: OwnerSnapshot) => void;
  readonly storage: IdentityPrivateStorage | null;
  readonly issuerEndpointId: () => EndpointId | null;
  readonly isTrustedIssuer: (networkId: NetworkId, endpointId: EndpointId) => boolean;
  readonly isAuthContextCurrent: (authContextRef: string, context: RequestContext) => boolean;
  readonly randomRef: () => string;
}

interface StagedRecord { readonly prefix: string; readonly networkId: string; readonly endpointId: EndpointId | null; readonly physicalRef: string | null; readonly connectionGeneration: number; readonly line: string; readonly kind: PrivateIdentityRecordKind; readonly expiresAt: number }
interface Continuation { readonly continuationRef: string; readonly networkId: NetworkId; readonly accountId: AccountId; readonly issuerEndpointId: EndpointId; readonly expiresAtMs: number; readonly secret: string; remembered: boolean }
interface StoredContinuation { readonly networkId: string; readonly accountId: string; readonly issuerEndpointId: string; readonly token: string; readonly expiresAtMs: number }
interface AuthAttempt { readonly continuation: Continuation; readonly owner: OwnerSnapshot }
const MAX_STAGE_MS = 15_000;
const MAX_RECORDS = 8;
const MAX_CONTINUATIONS = 16;
const MAX_STORAGE_CHARS = 64 * 1024;
const CONTINUATION_STORAGE_KEY = 'onyx:elm:account-continuations:v1';
const SESSION_TOKEN = /^:([^\s]+) NOTICE ([^\s]+) :SESSIONTOKEN ([A-Za-z0-9_.-]{1,64}) (sst_[0-9a-f]{32}) expires=(0|[1-9][0-9]{0,15})\r?\n?$/u;
const SESSION_TOKEN_SHAPE = /^SESSIONTOKEN(?:\s|$)/u;
const TOTP_RECOVERY_SHAPE = /^(?:TOTP:|RECOVERYCODES:)/u;

function classify(line: string): PrivateIdentityRecordKind | null {
  const match = /^:([^\s]+) (?:NOTICE [^\s]+|FAIL|WARN)(?:\s+[^: ]+)*\s+:(.*)$/u.exec(line);
  if (!match?.[2]) return null;
  if (SESSION_TOKEN_SHAPE.test(match[2])) return 'account-session-token';
  if (/^MACKEY(?:\s|$)/iu.test(match[2])) return 'mac-key';
  if (/^(?:ACCOUNT\s+)?RECOVERY\s+(?:CODE|CODES?)(?:\s|$)/iu.test(match[2])) return 'recovery-secret';
  if (TOTP_RECOVERY_SHAPE.test(match[2])) return 'account-security';
  if (/^PASSKEY\s+(?:CHALLENGE|ASSERTION)(?:\s|$)/iu.test(match[2])) return 'passkey-material';
  return null;
}

function validSessionToken(line: string): { prefix: string; recipient: string; accountId: string; token: string; expiresAtMs: number } | null {
  const match = SESSION_TOKEN.exec(line);
  if (!match?.[1] || !match[2] || !match[3] || !match[4] || !match[5]) return null;
  let expiresAtMs: number;
  try {
    const ms = BigInt(match[5]) * 1000n;
    if (ms <= 0n || ms > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    expiresAtMs = Number(ms);
  } catch { return null; }
  return { prefix: match[1], recipient: match[2], accountId: match[3], token: match[4], expiresAtMs };
}

/** Holds preregistration account material only transiently and never emits
 * its bytes. It becomes usable only after exact 001 identity and account proof. */
export function createIdentityOwner(deps: IdentityOwnerDependencies) {
  const now = deps.now ?? Date.now;
  const staged: StagedRecord[] = [];
  const continuations = new Map<string, Continuation>();
  const consentScopes = new Set<string>();
  const authAttempts = new Map<string, AuthAttempt>();
  let learnedPrefix: string | null = null;
  let provedOwnerRef: string | null = null;
  let provedAccountId: string | null = null;
  let continuationAvailable = false;
  let stageTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const scopeKey = (networkId: NetworkId, accountId: AccountId) => canonicalTupleKey([networkId, accountId]);
  const trustedIssuer = (networkId: NetworkId, endpointId: EndpointId) => deps.isTrustedIssuer(networkId, endpointId) === true;
  const issuer = () => deps.issuerEndpointId();
  const makeContinuationRef = (): string => {
    const ref = deps.randomRef();
    if (!/^[A-Za-z0-9_-]{22,128}$/u.test(ref)) throw new Error('continuation reference generator returned an invalid reference');
    return ref;
  };
  const validStoredRecord = (value: unknown): value is StoredContinuation => {
    if (!value || typeof value !== 'object') return false;
    const row = value as Record<string, unknown>;
    return Object.keys(row).sort().join(',') === 'accountId,expiresAtMs,issuerEndpointId,networkId,token'
      && typeof row.networkId === 'string' && row.networkId.length > 0 && row.networkId.length <= 128
      && typeof row.accountId === 'string' && /^[A-Za-z0-9_.-]{1,64}$/u.test(row.accountId)
      && typeof row.issuerEndpointId === 'string' && row.issuerEndpointId.length > 0 && row.issuerEndpointId.length <= 256
      && typeof row.token === 'string' && /^sst_[0-9a-f]{32}$/u.test(row.token)
      && typeof row.expiresAtMs === 'number' && Number.isSafeInteger(row.expiresAtMs) && row.expiresAtMs > now();
  };
  let storageLoaded = false;
  const loadRemembered = () => {
    if (storageLoaded) return;
    storageLoaded = true;
    if (!deps.storage) return;
    try {
      const raw = deps.storage.getItem(CONTINUATION_STORAGE_KEY);
      if (!raw || raw.length > MAX_STORAGE_CHARS) return;
      const value: unknown = JSON.parse(raw);
      if (!value || typeof value !== 'object') return;
      const object = value as Record<string, unknown>;
      if (Object.keys(object).sort().join(',') !== 'records,schemaVersion' || object.schemaVersion !== 1
        || !Array.isArray(object.records) || object.records.length > MAX_CONTINUATIONS) return;
      const loadedScopes = new Set<string>();
      for (const row of object.records) {
        if (!validStoredRecord(row)) continue;
        const networkId = row.networkId as NetworkId;
        const accountId = row.accountId as AccountId;
        const issuerEndpointId = row.issuerEndpointId as EndpointId;
        const scope = scopeKey(networkId, accountId);
        if (loadedScopes.has(scope) || !trustedIssuer(networkId, issuerEndpointId)) continue;
        loadedScopes.add(scope);
        const continuationRef = makeContinuationRef();
        continuations.set(continuationRef, { continuationRef, networkId, accountId, issuerEndpointId,
          expiresAtMs: row.expiresAtMs, secret: row.token, remembered: true });
        consentScopes.add(scopeKey(networkId, accountId));
      }
    } catch { /* guarded storage failure keeps memory custody available */ }
  };
  const persistRemembered = (): boolean => {
    if (!deps.storage) return false;
    try {
      const records: StoredContinuation[] = [...continuations.values()].filter(item => item.remembered && item.expiresAtMs > now())
        .slice(-MAX_CONTINUATIONS).map(item => ({ networkId: item.networkId, accountId: item.accountId,
          issuerEndpointId: item.issuerEndpointId, token: item.secret, expiresAtMs: item.expiresAtMs }));
      if (records.length === 0) deps.storage.removeItem(CONTINUATION_STORAGE_KEY);
      else {
        const raw = JSON.stringify({ schemaVersion: 1, records });
        if (raw.length > MAX_STORAGE_CHARS) return false;
        deps.storage.setItem(CONTINUATION_STORAGE_KEY, raw);
      }
      return true;
    } catch { return false; }
  };
  const removeContinuation = (entry: Continuation): void => {
    continuations.delete(entry.continuationRef);
    for (const [ref, attempted] of authAttempts) if (attempted.continuation === entry) authAttempts.delete(ref);
    if (entry.remembered) persistRemembered();
  };
  const acceptSessionToken = (line: string, owner: OwnerSnapshot): boolean => {
    const parsed = validSessionToken(line);
    const endpoint = issuer();
    if (!parsed || parsed.prefix !== learnedPrefix || parsed.accountId !== owner.accountId || !owner.accountId
      || parsed.expiresAtMs <= now() || parsed.expiresAtMs > now() + 30 * 24 * 60 * 60 * 1000
      || !endpoint || !trustedIssuer(owner.networkId, endpoint)) return false;
    const ref = makeContinuationRef();
    const scoped = scopeKey(owner.networkId, owner.accountId);
    const remembered = consentScopes.has(scoped);
    const entry: Continuation = { continuationRef: ref, networkId: owner.networkId, accountId: owner.accountId,
      issuerEndpointId: endpoint, expiresAtMs: parsed.expiresAtMs, secret: parsed.token, remembered };
    for (const old of [...continuations.values()]) {
      if (old.networkId === entry.networkId && old.accountId === entry.accountId && old.issuerEndpointId === entry.issuerEndpointId) removeContinuation(old);
    }
    continuations.set(ref, entry);
    continuationAvailable = true;
    if (remembered && !persistRemembered()) entry.remembered = false;
    deps.onNotice?.({ kind: 'account-session-token', available: true, owner });
    return true;
  };

  const current = (owner: OwnerSnapshot) => !disposed && deps.isCurrent(owner) && sameOwner(owner, deps.ownerSnapshot());
  const clearStage = () => { staged.length = 0; if (stageTimer !== null) clearTimeout(stageTimer); stageTimer = null; };
  const pruneStage = () => {
    const cutoff = now();
    for (let i = staged.length - 1; i >= 0; i -= 1) if ((staged[i]?.expiresAt ?? 0) <= cutoff) staged.splice(i, 1);
    if (staged.length === 0 && stageTimer !== null) { clearTimeout(stageTimer); stageTimer = null; }
  };
  const expireStage = () => {
    stageTimer = null;
    pruneStage();
    if (staged.length > 0) {
      const nextExpiry = Math.min(...staged.map(item => item.expiresAt));
      stageTimer = setTimeout(expireStage, Math.max(0, nextExpiry - now()));
    }
  };
  const clearAuthority = (owner: OwnerSnapshot, kind: PrivateIdentityRecordKind) => {
    deps.onNotice?.({ kind, available: false, owner });
  };
  const clearAccountContinuations = (owner: OwnerSnapshot): void => {
    if (!owner.accountId) return;
    for (const entry of [...continuations.values()]) {
      if (entry.networkId === owner.networkId && entry.accountId === owner.accountId) removeContinuation(entry);
    }
    continuationAvailable = false;
  };

  function admit(record: StagedRecord, owner: OwnerSnapshot): void {
    if (!current(owner) || record.prefix !== learnedPrefix || record.networkId !== owner.networkId || record.physicalRef !== owner.physicalRef
      || record.endpointId !== issuer() || record.connectionGeneration !== owner.connectionGeneration
      || provedOwnerRef !== owner.ownerRef || provedAccountId !== owner.accountId || !owner.accountId) return;
    if (record.kind === 'account-session-token') {
      acceptSessionToken(record.line, owner);
    } else if (record.kind === 'mac-key') {
      deps.onPrivateMediaRecord?.(record.line, owner);
    } else if (record.kind === 'account-security') {
      const body = /^:[^\s]+ NOTICE [^\s]+ :(.*?)(?:\r?\n)?$/u.exec(record.line)?.[1] ?? '';
      if (body === 'TOTP: two-factor authentication is now ACTIVE — future logins require a code'
        || /^TOTP: two-factor authentication (?:disabled|was not enabled)$/u.test(body)) clearAccountContinuations(owner);
      deps.onPrivateAccountLine?.(record.line, owner);
    } else {
      clearAuthority(owner, record.kind);
    }
    const index = staged.indexOf(record);
    if (index >= 0) staged.splice(index, 1);
  }

  return Object.freeze({
    observePrivateLine(line: string, owner: OwnerSnapshot): boolean {
      if (disposed) return true;
      pruneStage();
      const prefix = /^:([^\s]+) /u.exec(line)?.[1];
      const kind = classify(line);
      if (!prefix || !kind) return false;
      const item: StagedRecord = { prefix, networkId: owner.networkId, endpointId: issuer(), physicalRef: owner.physicalRef,
        connectionGeneration: owner.connectionGeneration, line, kind, expiresAt: now() + MAX_STAGE_MS };
      staged.push(item);
      while (staged.length > MAX_RECORDS) staged.shift();
      if (stageTimer === null) stageTimer = setTimeout(expireStage, MAX_STAGE_MS);
      if (learnedPrefix && prefix === learnedPrefix && provedOwnerRef === owner.ownerRef && provedAccountId === owner.accountId) admit(item, owner);
      return true;
    },
    learnServerPrefix(prefix: string, owner: OwnerSnapshot): void {
      if (!current(owner) || !prefix || /[\s\r\n\u0000-\u001f\u007f]/u.test(prefix)) return;
      if (learnedPrefix !== null && learnedPrefix !== prefix) return;
      learnedPrefix = prefix;
      pruneStage();
      for (const item of [...staged]) {
        if (item.expiresAt < now() || item.networkId !== owner.networkId || item.endpointId !== issuer()
          || item.physicalRef !== owner.physicalRef || item.connectionGeneration !== owner.connectionGeneration) continue;
        if (item.prefix === prefix && owner.accountId && provedAccountId === owner.accountId && provedOwnerRef === owner.ownerRef) admit(item, owner);
      }
    },
    proveAccount(owner: OwnerSnapshot): boolean {
      if (!current(owner) || !owner.accountId) return false;
      for (const [ref, attempt] of authAttempts) if (!sameOwner(attempt.owner, owner)) authAttempts.delete(ref);
      if (provedOwnerRef !== owner.ownerRef || provedAccountId !== owner.accountId) {
        continuationAvailable = [...continuations.values()].some(entry => entry.networkId === owner.networkId
          && entry.accountId === owner.accountId && entry.expiresAtMs > now());
        provedOwnerRef = owner.ownerRef;
        provedAccountId = owner.accountId;
      }
      if (learnedPrefix) {
        for (const item of [...staged]) {
          if (item.networkId === owner.networkId && item.physicalRef === owner.physicalRef && item.connectionGeneration === owner.connectionGeneration
            && item.prefix === learnedPrefix && item.expiresAt > now()) admit(item, owner);
        }
      }
      return true;
    },
    state(owner = deps.ownerSnapshot()): { readonly continuationAvailable: boolean; readonly accountId: string | null } {
      loadRemembered();
      const available = [...continuations.values()].some(entry => entry.networkId === owner.networkId
        && entry.accountId === owner.accountId && entry.expiresAtMs > now());
      return { continuationAvailable: current(owner) && provedOwnerRef === owner.ownerRef && provedAccountId === owner.accountId && available, accountId: owner.accountId };
    },
    /** Private-only handoff for an account authentication provider. */
    useAccountContinuation(_owner: OwnerSnapshot, _consume: (line: string) => void): boolean {
      // The legacy raw-line handoff is intentionally closed. SESSIONTOKEN is
      // available only through the scoped, mechanism-specific SASL methods.
      return false;
    },
    listAccountContinuations(): readonly ContinuationMetadata[] {
      loadRemembered();
      const owner = deps.ownerSnapshot();
      for (const entry of [...continuations.values()]) if (entry.expiresAtMs <= now()) removeContinuation(entry);
      const currentIssuer = issuer();
      return [...continuations.values()].filter(entry => entry.networkId === owner.networkId).map(entry => ({
        continuationRef: entry.continuationRef, networkId: entry.networkId, accountId: entry.accountId,
        issuerEndpointId: entry.issuerEndpointId, expiresAtMs: entry.expiresAtMs, remembered: entry.remembered,
        usable: entry.expiresAtMs > now() && currentIssuer === entry.issuerEndpointId && trustedIssuer(entry.networkId, entry.issuerEndpointId),
      }));
    },
    async setContinuationRememberConsent(input: { readonly networkId: NetworkId; readonly accountId: AccountId; readonly enabled: boolean }): Promise<boolean> {
      loadRemembered();
      const owner = deps.ownerSnapshot();
      const endpoint = issuer();
      if (disposed || !current(owner) || !deps.isCurrent(owner) || !owner.accountId || owner.accountId !== input.accountId
        || owner.networkId !== input.networkId || provedOwnerRef !== owner.ownerRef || provedAccountId !== owner.accountId
        || !endpoint || !trustedIssuer(input.networkId, endpoint)) return false;
      const key = scopeKey(input.networkId, input.accountId);
      if (input.enabled) consentScopes.add(key);
      else consentScopes.delete(key);
      for (const entry of continuations.values()) {
        if (entry.networkId === input.networkId && entry.accountId === input.accountId && entry.issuerEndpointId === endpoint) {
          entry.remembered = input.enabled;
        }
      }
      if (!persistRemembered()) {
        for (const entry of continuations.values()) if (entry.networkId === input.networkId && entry.accountId === input.accountId) entry.remembered = false;
        return false;
      }
      return true;
    },
    async forgetAccountContinuation(continuationRef: string): Promise<boolean> {
      loadRemembered();
      const entry = continuations.get(continuationRef);
      if (!entry) return false;
      const owner = deps.ownerSnapshot();
      if (!current(owner) || owner.networkId !== entry.networkId || (owner.accountId !== null && owner.accountId !== entry.accountId)) return false;
      consentScopes.delete(scopeKey(entry.networkId, entry.accountId));
      removeContinuation(entry);
      continuationAvailable = false;
      return true;
    },
    async prepareSessionTokenSasl(input: { readonly context: RequestContext; readonly continuationRef: string; readonly authContextRef: string }): Promise<SessionTokenSaslResult> {
      loadRemembered();
      const entry = continuations.get(input.continuationRef);
      if (!entry) return { kind: 'blocked', reason: 'invalid-ref' };
      const owner = input.context.owner;
      if (disposed || !current(owner) || !deps.isCurrent(owner) || !deps.isAuthContextCurrent(input.authContextRef, input.context)) {
        return { kind: 'blocked', reason: 'stale-context' };
      }
      if (owner.networkId !== entry.networkId) return { kind: 'blocked', reason: 'wrong-network' };
      if (owner.accountId !== null && owner.accountId !== entry.accountId) return { kind: 'blocked', reason: 'wrong-account' };
      if (deps.issuerEndpointId() !== entry.issuerEndpointId || !trustedIssuer(entry.networkId, entry.issuerEndpointId)) {
        return { kind: 'blocked', reason: 'wrong-issuer' };
      }
      if (entry.expiresAtMs <= now()) { removeContinuation(entry); return { kind: 'blocked', reason: 'expired' }; }
      if (!/^sst_[0-9a-f]{32}$/u.test(entry.secret) || authAttempts.has(input.authContextRef)) return { kind: 'blocked', reason: 'unavailable' };
      const payload = new TextEncoder().encode(`${entry.accountId}\u0000${entry.secret}`);
      if (payload.byteLength > 128 || !deps.isAuthContextCurrent(input.authContextRef, input.context)) {
        payload.fill(0);
        return { kind: 'blocked', reason: 'stale-context' };
      }
      authAttempts.set(input.authContextRef, { continuation: entry, owner });
      return { kind: 'ready', payload };
    },
    settleSessionTokenSasl(input: { readonly authContextRef: string; readonly result: 'accepted' | 'rejected' | 'unknown' }): void {
      const attempt = authAttempts.get(input.authContextRef);
      if (!attempt) return;
      authAttempts.delete(input.authContextRef);
      if (input.result === 'rejected') removeContinuation(attempt.continuation);
    },
    retire(owner: OwnerSnapshot): void {
      for (let i = staged.length - 1; i >= 0; i -= 1) if (staged[i]?.connectionGeneration === owner.connectionGeneration && staged[i]?.physicalRef === owner.physicalRef) staged.splice(i, 1);
      for (const [ref, attempt] of authAttempts) if (sameOwner(attempt.owner, owner)
        || (owner.physicalRef !== null && attempt.owner.physicalRef === owner.physicalRef && attempt.owner.connectionGeneration === owner.connectionGeneration)) authAttempts.delete(ref);
      if (provedOwnerRef === owner.ownerRef) { continuationAvailable = false; provedOwnerRef = null; provedAccountId = null; }
      if (learnedPrefix) learnedPrefix = null;
    },
    dispose(): void { disposed = true; clearStage(); learnedPrefix = null; provedOwnerRef = null; provedAccountId = null; continuationAvailable = false; authAttempts.clear(); },
  });
}

function sameOwner(a: OwnerSnapshot, b: OwnerSnapshot): boolean {
  return a.ownerRef === b.ownerRef && a.networkId === b.networkId && a.accountId === b.accountId
    && a.accountGeneration === b.accountGeneration && a.connectionGeneration === b.connectionGeneration
    && a.physicalRef === b.physicalRef;
}
