import {
  canonicalTupleKey,
  makeCredentialRef,
  makeRequestId,
  type AccountId,
  type CredentialRef,
  type EndpointId,
  type OwnerSnapshot,
  type RequestId,
  type SendAdmission,
} from './contracts';

export type CredentialKind = 'local-logical' | 'local-exact' | 'mesh-logical' | 'mesh-exact' | 'unknown';
export interface CredentialMetadata {
  readonly credentialRef: CredentialRef;
  readonly credentialKind: CredentialKind;
  readonly issuerEndpointId: EndpointId;
  readonly expiresAtMs: number | null;
  readonly restorable: boolean;
  readonly remembered: boolean;
}
export interface CredentialState {
  readonly owner: OwnerSnapshot;
  readonly credentials: readonly CredentialMetadata[];
  readonly remembered: boolean;
  readonly issuance: 'idle' | 'pending' | 'unknown';
}
export interface CredentialStorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export interface CredentialOwnerDependencies {
  readonly storage: CredentialStorageAdapter | null;
  readonly ownerSnapshot: () => OwnerSnapshot;
  readonly isCurrent: (snapshot: OwnerSnapshot) => boolean;
  readonly issuerEndpoint: () => EndpointId;
  readonly randomRef: () => string;
  readonly now: () => number;
  readonly emit: (state: CredentialState) => void;
  readonly onPrivateServerLine?: (line: string, owner: OwnerSnapshot) => void;
  readonly isTrustedEndpoint?: (endpoint: EndpointId) => boolean;
}
export interface ResumeTransport {
  sendLine(input: { readonly line: string; readonly owner: OwnerSnapshot; readonly requestId: RequestId }): SendAdmission;
}
export interface RecoveryCredentialLease {
  readonly credentialKind: CredentialKind;
  readonly issuerEndpointId: EndpointId;
  readonly expiresAtMs: number | null;
  resume(owner: OwnerSnapshot, requestId: RequestId): Promise<SendAdmission>;
  forget(): void;
  release(): void;
}
interface Holding extends CredentialMetadata {
  readonly ownerKey: string;
  readonly ownerRef: string;
  readonly networkId: string;
  readonly accountId: string;
  readonly secret: string;
}
interface Bundle {
  readonly schemaVersion: 2;
  readonly networkId: string;
  readonly accountId: string;
  readonly issuerEndpointId: string;
  readonly local: { readonly secret: string; readonly kind: CredentialKind; readonly expiresAtMs: number | null };
  readonly mesh: { readonly secret: string; readonly kind: CredentialKind; readonly expiresAtMs: number | null } | null;
}
interface Issuance {
  readonly owner: OwnerSnapshot;
  readonly issuerEndpointId: EndpointId;
  readonly barrier: string;
  local: { secret: string; kind: CredentialKind; expiresAtMs: number | null } | null;
  mesh: { secret: string; kind: CredentialKind; expiresAtMs: number | null } | null;
  failed: boolean;
}

const STORAGE_KEY = 'onyx:session-credentials-v2';
const LEGACY_KEY = 'onyx:credentials';
const MAX_SECRET_CHARS = 4096;
const MAX_STORAGE_CHARS = 96 * 1024;
const NONZERO_HEX32 = /^(?!0{32}$)[0-9a-f]{32}$/;
const LOCAL_EXACT = /^srm2l\.([0-9a-f]{32})\.([0-9a-f]{32})$/;
const MESH_EXACT = /^srm2m\.([0-9a-f]+)\.([0-9a-f]{32})$/;
const BARE = /^[0-9a-f]{32}$/;
const CREDENTIAL_NOTICE = /^:([^\s]+) NOTICE ([^\s]+) :SESSION (TOKEN|MTOKEN) ([^\s]+)(?: expires=(0|[1-9][0-9]{0,15}))?$/;
const PONG = /^:([^\s]+) PONG(?: [^\s]+)? :?([^\s]+)$/;
const SERVER_PRIVATE_NOTICE = /^:([^\s]+) (?:NOTICE [^\s]+|FAIL|WARN) :(.*)$/;
const CREDENTIAL_FAMILY = /^SESSION\s+(?:TOKEN|MTOKEN)(?:\s|$)/i;
const PRIVATE_FAMILY = /^(?:MACKEY(?:\s|$)|SESSIONTOKEN(?:\s|$)|AUTHENTICATE(?:\s|$)|ACCOUNT\s+RECOVERY\s+(?:CODE|CODES?)(?:\s|$)|RECOVERY\s+(?:CODE|CODES?)(?:\s|$)|TOTP:|RECOVERYCODES:|PASSKEY\s+(?:CHALLENGE|ASSERTION)(?:\s|$)|KEYTRANS\s+(?:PROOF|CHALLENGE)(?:\s|$))/i;
// Onyx Server negotiates standard-replies, so its SESSION refusals arrive
// prefixless (`FAIL SESSION <code> :text`); a prefixed form must be the server.
const ISSUE_FAILURE = /^(?::([^\s]+) )?(?:FAIL|WARN) SESSION(?:\s+([A-Z_]+))?(?:\s|$)/;

function ownerKey(owner: OwnerSnapshot, issuer: EndpointId): string | null {
  if (!owner.accountId) return null;
  return canonicalTupleKey([owner.networkId, owner.accountId, issuer]);
}
function parseExpiryMs(raw: string | undefined): number | null {
  if (!raw) return null;
  try {
    const millis = BigInt(raw) * 1000n;
    if (millis > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return Number(millis);
  } catch { return null; }
}
function kindForToken(kind: 'TOKEN' | 'MTOKEN', secret: string): CredentialKind {
  if (secret.length > MAX_SECRET_CHARS) return 'unknown';
  if (kind === 'TOKEN') {
    if (BARE.test(secret) && NONZERO_HEX32.test(secret)) return 'local-logical';
    const exact = LOCAL_EXACT.exec(secret);
    return exact && exact[1] && exact[2] && NONZERO_HEX32.test(exact[1]) && NONZERO_HEX32.test(exact[2]) ? 'local-exact' : 'unknown';
  }
  if (/^53524d01[0-9a-f]+$/.test(secret) && secret.length >= 132 && secret.length <= 8192 && secret.length % 2 === 0) return 'mesh-logical';
  const exact = MESH_EXACT.exec(secret);
  if (!exact || !exact[1] || !exact[2] || !NONZERO_HEX32.test(exact[2])) return 'unknown';
  const claim = exact[1];
  // SRM2 claim wire: magic/version, fixed claims, 1..64-byte account, and
  // signer+signature. This recognizes only the sealed envelope shape; the
  // server remains the authority that verifies the cryptographic claim.
  return claim.startsWith('53524d02') && claim.length >= 350 && claim.length <= 478 && claim.length % 2 === 0 ? 'mesh-exact' : 'unknown';
}
function privateRecord(line: string): { prefix: string; body: string } | null {
  const match = SERVER_PRIVATE_NOTICE.exec(line);
  return match?.[1] && match[2] ? { prefix: match[1], body: match[2] } : null;
}
function knownCredentialKind(value: unknown): value is CredentialKind {
  return value === 'local-logical' || value === 'local-exact' || value === 'mesh-logical' || value === 'mesh-exact';
}
function parseCredentialLine(line: string): { prefix: string; kind: 'TOKEN' | 'MTOKEN'; secret: string; expiresAtMs: number | null; expiryText: string | undefined } | null {
  if (line.length > MAX_SECRET_CHARS + 1024) return null;
  const notice = CREDENTIAL_NOTICE.exec(line);
  const match = notice;
  if (!match) return null;
  const prefix = match[1];
  const kind = match[3];
  const secret = match[4];
  const expiry = match[5];
  if (!prefix || (kind !== 'TOKEN' && kind !== 'MTOKEN') || !secret || /[\s\u0000-\u001f\u007f]/.test(secret)) return null;
  return { prefix, kind, secret, expiresAtMs: parseExpiryMs(expiry), expiryText: expiry };
}
function barrierFromLine(line: string, cookie: string): string | null {
  const match = PONG.exec(line);
  return match?.[1] && match[2] === cookie ? match[1] : null;
}
function safeRef(make: () => string): CredentialRef {
  const ref = makeCredentialRef(make());
  if (!ref) throw new Error('credential reference generator returned an invalid reference');
  return ref;
}
function safeRequestId(make: () => string): RequestId {
  const id = makeRequestId(make());
  if (!id) throw new Error('request reference generator returned an invalid reference');
  return id;
}

/** Private closure holding credential bytes. Public methods return metadata,
 * opaque references, or send a selected secret directly to the active socket. */
export function createCredentialOwner(deps: CredentialOwnerDependencies) {
  const holdings = new Map<CredentialRef, Holding>();
  const rememberedScopes = new Set<string>();
  const subscribers = new Set<(state: CredentialState) => void>();
  let learnedPrefix: string | null = null;
  let learnedOwnerKey: string | null = null;
  let issuance: Issuance | null = null;
  let issuanceTimer: ReturnType<typeof setTimeout> | null = null;
  let issuanceUnknown = false;
  let disposed = false;

  const ownerIsCurrent = (snapshot: OwnerSnapshot): boolean => {
    if (disposed || !deps.isCurrent(snapshot)) return false;
    const current = deps.ownerSnapshot();
    return canonicalTupleKey([snapshot.networkId, snapshot.accountId ?? '', snapshot.ownerRef, String(snapshot.accountGeneration), String(snapshot.connectionGeneration)])
      === canonicalTupleKey([current.networkId, current.accountId ?? '', current.ownerRef, String(current.accountGeneration), String(current.connectionGeneration)]);
  };

  function restoreRemembered(owner: OwnerSnapshot, issuer: EndpointId): void {
    const scope = ownerKey(owner, issuer);
    if (!scope || !deps.storage || !ownerIsCurrent(owner)) return;
    let parsed: unknown;
    let raw: string | null;
    try { raw = deps.storage.getItem(STORAGE_KEY); } catch { return; }
    if (raw === null || raw.length > MAX_STORAGE_CHARS) return;
    try { parsed = JSON.parse(raw); } catch { return; }
    if (!parsed || typeof parsed !== 'object') return;
    const record = (parsed as Record<string, unknown>)[scope];
    if (!record || typeof record !== 'object') return;
    const bundle = record as Partial<Bundle>;
    if (bundle.schemaVersion !== 2 || bundle.networkId !== owner.networkId || bundle.accountId !== owner.accountId || bundle.issuerEndpointId !== issuer || !bundle.local
      || typeof bundle.local !== 'object' || !knownCredentialKind(bundle.local.kind) || typeof bundle.local.secret !== 'string') return;
    const add = (entry: unknown, slot: 'TOKEN' | 'MTOKEN') => {
      if (!entry || typeof entry !== 'object') return;
      const stored = entry as Record<string, unknown>;
      if (typeof stored.secret !== 'string' || stored.secret.length > MAX_SECRET_CHARS || !knownCredentialKind(stored.kind)) return;
      const ref = safeRef(deps.randomRef);
      const claimedKind = stored.kind;
      const recognizedKind = kindForToken(slot, stored.secret);
      const expiryValid = stored.expiresAtMs === null || (typeof stored.expiresAtMs === 'number' && Number.isSafeInteger(stored.expiresAtMs) && stored.expiresAtMs >= 0);
      const valid = recognizedKind === claimedKind && (slot === 'TOKEN' ? claimedKind.startsWith('local-') : claimedKind.startsWith('mesh-')) && expiryValid;
      if (!valid) return;
      const metadata: CredentialMetadata = { credentialRef: ref, credentialKind: claimedKind, issuerEndpointId: issuer, expiresAtMs: stored.expiresAtMs as number | null, restorable: true, remembered: true };
      holdings.set(ref, { ...metadata, ownerKey: scope, ownerRef: owner.ownerRef, networkId: owner.networkId, accountId: owner.accountId ?? '', secret: stored.secret });
    };
    add(bundle.local, 'TOKEN');
    if (bundle.mesh !== null && bundle.mesh !== undefined) add(bundle.mesh, 'MTOKEN');
    rememberedScopes.add(scope);
  }

  function state(owner = deps.ownerSnapshot()): CredentialState {
    const issuer = deps.issuerEndpoint();
    const scope = ownerKey(owner, issuer);
    return {
      owner,
      credentials: Array.from(holdings.values()).filter(item => item.networkId === owner.networkId && item.accountId === (owner.accountId ?? '')
        && (item.issuerEndpointId === issuer || (item.credentialKind.startsWith('mesh-') && deps.isTrustedEndpoint?.(issuer) === true)))
        .map(({ credentialRef, credentialKind, issuerEndpointId, expiresAtMs, restorable, remembered }) => ({ credentialRef, credentialKind, issuerEndpointId, expiresAtMs, restorable, remembered })),
      remembered: scope !== null && rememberedScopes.has(scope),
      issuance: issuance ? 'pending' : issuanceUnknown ? 'unknown' : 'idle',
    };
  }
  function publish(owner = deps.ownerSnapshot()): void {
    if (!ownerIsCurrent(owner)) return;
    const current = state(owner);
    deps.emit(current);
    subscribers.forEach(listener => listener(current));
  }
  function rememberBundle(owner: OwnerSnapshot, issuer: EndpointId, local: Issuance['local'], mesh: Issuance['mesh']): boolean {
    const scope = ownerKey(owner, issuer);
    if (!scope || !deps.storage) return false;
    try {
      const store = JSON.parse(deps.storage.getItem(STORAGE_KEY) ?? '{}') as Record<string, unknown>;
      const next: Bundle = {
        schemaVersion: 2,
        networkId: owner.networkId,
        accountId: owner.accountId as AccountId,
        issuerEndpointId: issuer,
        local: local!,
        mesh,
      };
      store[scope] = next;
      const serialized = JSON.stringify(store);
      if (serialized.length > MAX_STORAGE_CHARS) return false;
      deps.storage.setItem(STORAGE_KEY, serialized);
      rememberedScopes.add(scope);
      return true;
    } catch { return false; }
  }
  function mintHolding(owner: OwnerSnapshot, issuer: EndpointId, entry: NonNullable<Issuance['local']>, remembered: boolean): void {
    const scope = ownerKey(owner, issuer);
    if (!scope) return;
    const ref = safeRef(deps.randomRef);
    const metadata: CredentialMetadata = { credentialRef: ref, credentialKind: entry.kind, issuerEndpointId: issuer, expiresAtMs: entry.expiresAtMs, restorable: entry.kind !== 'unknown', remembered };
    holdings.set(ref, { ...metadata, ownerKey: scope, ownerRef: owner.ownerRef, networkId: owner.networkId, accountId: owner.accountId ?? '', secret: entry.secret });
  }
  function handleCredential(line: string, trustedPrefix: string, owner: OwnerSnapshot): boolean {
    const parsed = parseCredentialLine(line);
    if (!parsed) {
      const record = privateRecord(line);
      return Boolean(record && CREDENTIAL_FAMILY.test(record.body));
    }
    if (!issuance || issuance.failed || !ownerIsCurrent(owner) || !owner.accountId || parsed.prefix !== trustedPrefix || trustedPrefix !== learnedPrefix || issuance.owner.accountId !== owner.accountId || issuance.issuerEndpointId !== deps.issuerEndpoint()) return true;
    const kind = parsed.expiryText !== undefined && parsed.expiresAtMs === null ? 'unknown' : kindForToken(parsed.kind, parsed.secret);
    const entry = { secret: parsed.secret, kind, expiresAtMs: parsed.expiresAtMs };
    if (parsed.kind === 'TOKEN') issuance.local = entry;
    else issuance.mesh = entry;
    return true;
  }
  function handleIssueFailure(line: string, owner: OwnerSnapshot): boolean {
    const match = ISSUE_FAILURE.exec(line);
    if (!match || (match[1] !== undefined && match[1] !== learnedPrefix) || learnedPrefix === null || !issuance || !ownerIsCurrent(owner)) return false;
    const code = match[2] ?? '';
    if (!['TEMPORARILY_UNAVAILABLE', 'ORIGIN_UNREACHABLE', 'RESUME_CREDENTIAL_PRESERVED', 'SESSION_REVOKED', 'INVALID_TOKEN', 'NO_SESSION'].includes(code)) return false;
    issuance.failed = true;
    issuance = null;
    if (issuanceTimer !== null) clearTimeout(issuanceTimer);
    issuanceTimer = null;
    issuanceUnknown = true;
    publish(owner);
    return true;
  }
  function finishBarrier(line: string, owner: OwnerSnapshot): boolean {
    if (!issuance || !ownerIsCurrent(owner) || !owner.accountId) return false;
    const prefix = barrierFromLine(line, issuance.barrier);
    if (!prefix || prefix !== learnedPrefix) return false;
    const done = issuance;
    issuance = null;
    if (issuanceTimer !== null) clearTimeout(issuanceTimer);
    issuanceTimer = null;
    issuanceUnknown = !(done.local && done.local.kind !== 'unknown');
    if (issuanceUnknown || !done.local) { publish(owner); return true; }
    const scope = ownerKey(owner, done.issuerEndpointId);
    if (!scope) { issuanceUnknown = true; publish(owner); return true; }
    const consented = rememberedScopes.has(scope);
    const persistenceSucceeded = !consented || rememberBundle(owner, done.issuerEndpointId, done.local, done.mesh);
    // Replace this issuer's entire bundle; absent MTOKEN clears any prior mesh
    // credential so exact claims from different issuances can never mix.
    for (const [ref, holding] of holdings) if (holding.ownerKey === scope) holdings.delete(ref);
    mintHolding(owner, done.issuerEndpointId, done.local, consented && persistenceSucceeded);
    if (done.mesh) mintHolding(owner, done.issuerEndpointId, done.mesh, consented && persistenceSucceeded);
    issuanceUnknown = !persistenceSucceeded;
    publish(owner);
    return true;
  }

  return Object.freeze({
    learnServerPrefix(prefix: string, owner: OwnerSnapshot): boolean {
      if (!ownerIsCurrent(owner) || !prefix || /[\s\r\n\u0000-\u001f\u007f]/.test(prefix)) return false;
      const ownerKey = canonicalTupleKey([owner.ownerRef, String(owner.accountGeneration), String(owner.connectionGeneration)]);
      if (learnedPrefix === prefix && learnedOwnerKey === ownerKey) return true;
      learnedPrefix = prefix;
      learnedOwnerKey = ownerKey;
      restoreRemembered(owner, deps.issuerEndpoint());
      publish(owner);
      return true;
    },
    /** Consume secret-bearing lines before they can be serialized to Elm. */
    consumePrivateLine(line: string, authenticatedPrefix: string | null, owner: OwnerSnapshot): boolean {
      if (disposed) return true;
      if (handleCredential(line, authenticatedPrefix ?? '', owner)) return true;
      if (finishBarrier(line, owner)) return true;
      if (handleIssueFailure(line, owner)) return true;
      const record = privateRecord(line);
      if (record && (CREDENTIAL_FAMILY.test(record.body) || PRIVATE_FAMILY.test(record.body))) {
        // Account-auth and recovery material can precede 001. Hand it only
        // to the private identity owner, which stages it under this exact
        // socket generation until welcome and account proof are established.
        deps.onPrivateServerLine?.(line, owner);
        return true;
      }
      return false;
    },
    subscribe(listener: (state: CredentialState) => void) {
      subscribers.add(listener);
      listener(state());
      return () => subscribers.delete(listener);
    },
    setRememberConsent(owner: OwnerSnapshot, remember: boolean): boolean {
      if (!ownerIsCurrent(owner) || !owner.accountId) return false;
      const issuer = deps.issuerEndpoint();
      const scope = ownerKey(owner, issuer);
      if (!scope || !deps.storage) return false;
      if (!remember) {
        try {
          const store = JSON.parse(deps.storage.getItem(STORAGE_KEY) ?? '{}') as Record<string, unknown>;
          delete store[scope];
          deps.storage.setItem(STORAGE_KEY, JSON.stringify(store));
        } catch { return false; }
        rememberedScopes.delete(scope);
        for (const [ref, holding] of holdings) if (holding.ownerKey === scope) holdings.set(ref, { ...holding, remembered: false });
      } else {
        rememberedScopes.add(scope);
        const items = Array.from(holdings.values()).filter(item => item.ownerKey === scope && item.restorable);
        const local = items.find(item => item.credentialKind.startsWith('local-'));
        const mesh = items.find(item => item.credentialKind.startsWith('mesh-'));
        if (!local) { publish(owner); return true; }
        const localEntry = { secret: local.secret, kind: local.credentialKind, expiresAtMs: local.expiresAtMs };
        const meshEntry = mesh ? { secret: mesh.secret, kind: mesh.credentialKind, expiresAtMs: mesh.expiresAtMs } : null;
        if (!rememberBundle(owner, issuer, localEntry, meshEntry)) return false;
        for (const item of items) holdings.set(item.credentialRef, { ...item, remembered: true });
      }
      publish(owner);
      return true;
    },
    issueBundle(owner: OwnerSnapshot, transport: ResumeTransport): SendAdmission {
      if (!ownerIsCurrent(owner)) return { kind: 'blocked', reason: 'owner-changed' };
      if (!owner.accountId || learnedPrefix === null || issuance !== null) return { kind: 'blocked', reason: 'policy' };
      const barrier = `onyx-session-token-${deps.randomRef()}`;
      if (/[^A-Za-z0-9_-]/.test(barrier) || barrier.length > 160) return { kind: 'blocked', reason: 'invalid-intent' };
      const issuerEndpointId = deps.issuerEndpoint();
      issuance = { owner, issuerEndpointId, barrier, local: null, mesh: null, failed: false };
      issuanceUnknown = false;
      if (issuanceTimer !== null) clearTimeout(issuanceTimer);
      issuanceTimer = setTimeout(() => {
        if (issuance?.owner.ownerRef !== owner.ownerRef) return;
        issuance = null;
        issuanceTimer = null;
        issuanceUnknown = true;
        publish(owner);
      }, 10_000);
      const first = transport.sendLine({ line: 'SESSION TOKEN', owner, requestId: safeRequestId(deps.randomRef) });
      if (first.kind === 'blocked') { issuance = null; clearTimeout(issuanceTimer); issuanceTimer = null; return first; }
      const second = transport.sendLine({ line: `PING :${barrier}`, owner, requestId: safeRequestId(deps.randomRef) });
      if (second.kind === 'blocked') {
        issuance = null;
        clearTimeout(issuanceTimer); issuanceTimer = null;
        issuanceUnknown = true;
        publish(owner);
        return first.kind === 'unknown' ? first : second;
      }
      publish(owner);
      return first.kind === 'unknown' ? first : second;
    },
    resume(owner: OwnerSnapshot, credentialRef: CredentialRef, transport: ResumeTransport): SendAdmission {
      if (!ownerIsCurrent(owner)) return { kind: 'blocked', reason: 'owner-changed' };
      if (!owner.accountId) return { kind: 'blocked', reason: 'policy' };
      const item = holdings.get(credentialRef);
      const local = item?.credentialKind.startsWith('local-') ?? false;
      if (!item || !item.restorable || item.networkId !== owner.networkId || item.accountId !== owner.accountId
        || (local && item.issuerEndpointId !== deps.issuerEndpoint()) || (!local && deps.isTrustedEndpoint?.(deps.issuerEndpoint()) !== true)) return { kind: 'blocked', reason: 'policy' };
      if (item.expiresAtMs !== null && item.expiresAtMs <= deps.now()) return { kind: 'blocked', reason: 'policy' };
      return transport.sendLine({ line: `SESSION RESUME ${item.secret}`, owner, requestId: safeRequestId(deps.randomRef) });
    },
    pinForRecovery(owner: OwnerSnapshot, credentialRef: CredentialRef, transport: ResumeTransport): RecoveryCredentialLease | null {
      if (!ownerIsCurrent(owner) || !owner.accountId) return null;
      const item = holdings.get(credentialRef);
      if (!item || !item.restorable || item.networkId !== owner.networkId || item.accountId !== owner.accountId
        || (item.credentialKind.startsWith('local-') && item.issuerEndpointId !== deps.issuerEndpoint())
        || (item.credentialKind.startsWith('mesh-') && deps.isTrustedEndpoint?.(deps.issuerEndpoint()) !== true)) return null;
      let released = false;
      const secret = item.secret;
      return {
        credentialKind: item.credentialKind,
        issuerEndpointId: item.issuerEndpointId,
        expiresAtMs: item.expiresAtMs,
        async resume(nextOwner, requestId) {
          if (released || !ownerIsCurrent(nextOwner) || nextOwner.networkId !== item.networkId || nextOwner.accountId !== item.accountId
            || (item.credentialKind.startsWith('local-') && item.issuerEndpointId !== deps.issuerEndpoint())
            || (item.credentialKind.startsWith('mesh-') && deps.isTrustedEndpoint?.(deps.issuerEndpoint()) !== true)
            || (item.expiresAtMs !== null && item.expiresAtMs <= deps.now())) return { kind: 'blocked', reason: 'policy' };
          return transport.sendLine({ line: `SESSION RESUME ${secret}`, owner: nextOwner, requestId });
        },
        forget() {
          const live=holdings.get(credentialRef);
          if(live===item)holdings.delete(credentialRef);
          const scope=item.ownerKey;
          if(rememberedScopes.has(scope)&&deps.storage){
            try{
              const store=JSON.parse(deps.storage.getItem(STORAGE_KEY)??'{}') as Record<string,unknown>;
              const record=store[scope] as Partial<Bundle>|undefined;
              if(record&&record.schemaVersion===2&&record.networkId===item.networkId&&record.accountId===item.accountId&&record.issuerEndpointId===item.issuerEndpointId){
                let local=record.local??null;let mesh=record.mesh??null;
                if(local&&local.secret===secret)local=null;
                if(mesh&&mesh.secret===secret)mesh=null;
                if(!local){
                  // The v2 remembered bundle is anchored by a local credential.
                  // Keep any surviving mesh credential in its live private
                  // holding, but remove the now-unrepresentable remembered bundle.
                  delete store[scope];rememberedScopes.delete(scope);
                  for(const [ref,holding] of holdings)if(holding.ownerKey===scope)holdings.set(ref,{...holding,remembered:false});
                }else if(!mesh){delete store[scope];rememberedScopes.delete(scope);}
                else{store[scope]={...record,local,mesh};}
                deps.storage.setItem(STORAGE_KEY,JSON.stringify(store));
              }
            }catch{/* private remembered state remains unavailable; no public secret detail */}
          }
          if(deps.ownerSnapshot().networkId===item.networkId&&deps.ownerSnapshot().accountId===item.accountId)publish();
        },
        release() { released = true; },
      };
    },
    forget(owner: OwnerSnapshot, credentialRef: CredentialRef): boolean {
      if (!ownerIsCurrent(owner)) return false;
      const item = holdings.get(credentialRef);
      if (!item || item.ownerKey !== ownerKey(owner, item.issuerEndpointId)) return false;
      holdings.delete(credentialRef);
      const scope = item.ownerKey;
      const remaining = Array.from(holdings.values()).filter(value => value.ownerKey === scope && value.restorable);
      if (rememberedScopes.has(scope)) {
        const local = remaining.find(value => value.credentialKind.startsWith('local-'));
        const mesh = remaining.find(value => value.credentialKind.startsWith('mesh-'));
        if (!local) {
          try {
            const store = JSON.parse(deps.storage?.getItem(STORAGE_KEY) ?? '{}') as Record<string, unknown>;
            delete store[scope];
            deps.storage?.setItem(STORAGE_KEY, JSON.stringify(store));
          } catch { /* authority is removed from the live owner regardless */ }
          rememberedScopes.delete(scope);
        } else {
          rememberBundle(owner, item.issuerEndpointId, { secret: local.secret, kind: local.credentialKind, expiresAtMs: local.expiresAtMs }, mesh ? { secret: mesh.secret, kind: mesh.credentialKind, expiresAtMs: mesh.expiresAtMs } : null);
        }
      }
      publish(owner);
      return true;
    },
    state,
    legacyNeedsReview(owner: OwnerSnapshot): boolean {
      if (!ownerIsCurrent(owner) || !owner.accountId || !deps.storage) return false;
      try {
        const parsed = JSON.parse(deps.storage.getItem(LEGACY_KEY) ?? 'null') as { slots?: Record<string, unknown> } | null;
        const host = deps.issuerEndpoint();
        return Boolean(parsed?.slots && Object.keys(parsed.slots).some(key => key.startsWith(`${host}|`)));
      } catch { return false; }
    },
    expireIssuance(owner: OwnerSnapshot): boolean {
      if (!issuance || issuance.owner.ownerRef !== owner.ownerRef || !ownerIsCurrent(owner)) return false;
      issuance = null;
      issuanceUnknown = true;
      publish(owner);
      return true;
    },
    retire(owner: OwnerSnapshot): void {
      if (issuance?.owner.ownerRef === owner.ownerRef) { issuance = null; issuanceUnknown = true; }
      if (issuanceTimer !== null) clearTimeout(issuanceTimer);
      issuanceTimer = null;
      learnedPrefix = null;
      learnedOwnerKey = null;
      for (const [ref, holding] of holdings) if (holding.ownerRef === owner.ownerRef) holdings.delete(ref);
      publish();
    },
    dispose(): void {
      disposed = true;
      issuance = null;
      if (issuanceTimer !== null) clearTimeout(issuanceTimer);
      issuanceTimer = null;
      learnedPrefix = null;
      holdings.clear();
      subscribers.clear();
    },
  });
}
