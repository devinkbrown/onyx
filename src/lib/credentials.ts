// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * lib/credentials.ts
 * Onyx — login credential persistence
 *
 * Storage layout (localStorage key: 'onyx:credentials'):
 *   version     — storage schema version
 *   activeKey   — last-used credential key
 *   entries     — saved credentials keyed by normalized server + nick
 *
 * Session tokens are issued by Orochi after successful account authentication via:
 *   NOTE SESSION TOKEN :<token>
 * Saved tokens are reused with SESSION RESUME after IRC registration. They are
 * bearer reclaim credentials, not SASL mechanisms, so a current token can
 * restore a passwordless/passkey account without rerunning SASL.
 *
 * On mesh deployments Orochi additionally emits:
 *   NOTE SESSION MTOKEN :<token>
 * a mesh-sealed reclaim token usable to resume the session from ANY node in the
 * mesh (server.zig handleSession TOKEN). It is longer than the 32-hex local
 * token; `SESSION RESUME <mtoken>` routes through handleMeshReclaim, which either
 * reclaims a detached session held locally or redirects to the owning node.
 *
 * When no token is present (first login or expired), a saved password can be
 * used for SASL PLAIN / SCRAM. The password is stored in plain text — same as
 * every desktop IRC client config file.
 */

const KEY = 'onyx:credentials';
export const MAX_CREDENTIALS_STORAGE_CHARS = 2 * 1024 * 1024;

export interface SavedCredentials {
  nick: string;
  server: string;
  /** NickServ / SASL password — only set when user opted in AND no valid token */
  password?: string;
  /** Orochi-issued session resume token (local node only) */
  sessionToken?: string;
  /** Orochi-issued mesh-sealed reclaim token (resumes from any mesh node) */
  meshToken?: string;
  /** Token validity deadline — ISO string */
  tokenExpiry?: string;
  /** When these credentials were last written */
  savedAt: string;
}

/** Exact remembered identity to receive a token rotation. */
export interface CredentialTokenTarget {
  server: string;
  nick: string;
}

export interface AccountHandoff {
  nick: string;
  server: string;
  savedAt?: string;
  active?: boolean;
}

export type RememberedIdentityAccess = 'resume' | 'sign-in' | 'identity-only';

/**
 * Secret-free account metadata for identity pickers.
 *
 * `server` is a display label with URL credentials, query parameters, and
 * fragments removed. `id` is an opaque local reference; neither field contains
 * a password or reclaim token.
 */
export interface RememberedIdentity {
  id: string;
  nick: string;
  server: string;
  savedAt: string;
  active: boolean;
  access: RememberedIdentityAccess;
}

interface CredentialsStore {
  version: 2;
  activeKey?: string;
  entries: Record<string, SavedCredentials>;
}

const MAX_HANDOFFS = 12;
const MAX_HANDOFF_FIELD = 256;

function normalizeServer(server: string): string {
  const trimmed = server.trim();
  try {
    const url = new URL(trimmed);
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();
    return url.toString().replace(/\/$/, '');
  } catch {
    return trimmed.toLowerCase().replace(/\/$/, '');
  }
}

function credentialKey(server: string, nick: string): string {
  return `${normalizeServer(server)}|${nick.trim().toLowerCase()}`;
}

function tokenTargetKey(
  store: CredentialsStore,
  target?: CredentialTokenTarget,
): string | undefined {
  if (target) {
    const exact = credentialKey(target.server, target.nick);
    return store.entries[exact] ? exact : undefined;
  }
  const active = store.activeKey ?? Object.keys(store.entries)[0];
  return active && store.entries[active] ? active : undefined;
}

function identityId(key: string): string {
  // Two independent 32-bit hashes make a compact, stable reference without
  // exposing the normalized credential key (which can contain a URL path).
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < key.length; index += 1) {
    const code = key.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `saved-${(first >>> 0).toString(36)}-${(second >>> 0).toString(36)}`;
}

function serverDisplayLabel(server: string): string {
  const trimmed = server.trim();
  try {
    const url = new URL(trimmed);
    const path = url.pathname === '/' ? '' : url.pathname;
    return `${url.protocol}//${url.host}${path}`.slice(0, MAX_HANDOFF_FIELD);
  } catch {
    // A hand-edited or imported non-URL endpoint should still be recognizable,
    // but never echo URL-style credentials, query secrets, or control bytes.
    return trimmed
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .split(/[?#]/, 1)[0]!
      .replace(/^([^/]*\/\/)?[^/@]+@/, '$1')
      .slice(0, MAX_HANDOFF_FIELD);
  }
}

function hasPassword(creds: SavedCredentials): boolean {
  return typeof creds.password === 'string' && creds.password.length > 0;
}

function hasCurrentToken(creds: SavedCredentials): boolean {
  const hasToken = (typeof creds.sessionToken === 'string' && creds.sessionToken.length > 0)
    || (typeof creds.meshToken === 'string' && creds.meshToken.length > 0);
  if (!hasToken) return false;
  if (!creds.tokenExpiry) return true;
  const expiry = Date.parse(creds.tokenExpiry);
  return Number.isFinite(expiry) && Date.now() < expiry;
}

function identityAccess(creds: SavedCredentials): RememberedIdentityAccess {
  // SESSION RESUME is itself the bearer-authenticated reclaim path. This must
  // be token-first because passkey identities intentionally have no password.
  if (hasCurrentToken(creds)) return 'resume';
  return hasPassword(creds) ? 'sign-in' : 'identity-only';
}

function isSavedCredentials(value: unknown): value is SavedCredentials {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SavedCredentials>;
  return typeof candidate.nick === 'string'
    && candidate.nick.length > 0
    && typeof candidate.server === 'string'
    && candidate.server.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeHandoff(value: unknown): AccountHandoff | null {
  if (!isRecord(value)) return null;
  const nick = typeof value.nick === 'string' ? value.nick.trim().slice(0, MAX_HANDOFF_FIELD) : '';
  const server = typeof value.server === 'string' ? value.server.trim().slice(0, MAX_HANDOFF_FIELD) : '';
  if (!nick || !server) return null;
  return {
    nick,
    server,
    ...(typeof value.savedAt === 'string' ? { savedAt: value.savedAt.slice(0, MAX_HANDOFF_FIELD) } : {}),
    ...(value.active === true ? { active: true } : {}),
  };
}

function readStore(): CredentialsStore | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(KEY);
  if (!raw || raw.length > MAX_CREDENTIALS_STORAGE_CHARS) return null;

  const parsed = JSON.parse(raw) as unknown;
  if (
    parsed
    && typeof parsed === 'object'
    && (parsed as { version?: unknown }).version === 2
    && (parsed as { entries?: unknown }).entries
    && typeof (parsed as { entries: unknown }).entries === 'object'
  ) {
    const entries: Record<string, SavedCredentials> = {};
    for (const [key, value] of Object.entries((parsed as CredentialsStore).entries)) {
      if (isSavedCredentials(value)) entries[key] = value;
    }
    return {
      version: 2,
      activeKey: typeof (parsed as CredentialsStore).activeKey === 'string'
        ? (parsed as CredentialsStore).activeKey
        : undefined,
      entries,
    };
  }

  // Legacy single-credential object.
  if (isSavedCredentials(parsed)) {
    const key = credentialKey(parsed.server, parsed.nick);
    return { version: 2, activeKey: key, entries: { [key]: parsed } };
  }

  return null;
}

function writeStore(store: CredentialsStore): void {
  localStorage.setItem(KEY, JSON.stringify(store));
}

function purgeExpiredTokens(store: CredentialsStore): boolean {
  let changed = false;
  for (const [key, creds] of Object.entries(store.entries)) {
    const hasToken = (typeof creds.sessionToken === 'string' && creds.sessionToken.length > 0)
      || (typeof creds.meshToken === 'string' && creds.meshToken.length > 0);
    const expiry = creds.tokenExpiry ? Date.parse(creds.tokenExpiry) : Number.NaN;
    if (hasToken && creds.tokenExpiry && (!Number.isFinite(expiry) || Date.now() >= expiry)) {
      store.entries[key] = {
        ...creds,
        sessionToken: undefined,
        meshToken: undefined,
        tokenExpiry: undefined,
      };
      changed = true;
    }
  }
  return changed;
}

/** Bound durable credential material, preserving the active and newest entries. */
function enforceCredentialLimit(store: CredentialsStore): boolean {
  const keys = Object.keys(store.entries);
  if (keys.length <= MAX_HANDOFFS) return false;
  keys.sort((left, right) => {
    if (left === store.activeKey) return -1;
    if (right === store.activeKey) return 1;
    const leftTime = Date.parse(store.entries[left]?.savedAt ?? '');
    const rightTime = Date.parse(store.entries[right]?.savedAt ?? '');
    const byTime = (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
    return byTime || left.localeCompare(right);
  });
  const keep = new Set(keys.slice(0, MAX_HANDOFFS));
  for (const key of keys) {
    if (!keep.has(key)) delete store.entries[key];
  }
  if (!store.activeKey || !store.entries[store.activeKey]) store.activeKey = keys[0];
  return true;
}

/** Load credentials from localStorage. Returns null when nothing is saved. */
export function loadCredentials(server?: string, nick?: string): SavedCredentials | null {
  if (typeof window === 'undefined') return null;
  try {
    const store = readStore();
    if (!store) return null;
    const tokensChanged = purgeExpiredTokens(store);
    const limitChanged = enforceCredentialLimit(store);
    const changed = tokensChanged || limitChanged;
    if (changed) writeStore(store);

    const key = server && nick ? credentialKey(server, nick) : store.activeKey;
    const creds = key ? store.entries[key] : Object.values(store.entries)[0];
    return creds ?? null;
  } catch {
    return null;
  }
}

/** List remembered identities without returning passwords or session tokens. */
export function listRememberedIdentities(): RememberedIdentity[] {
  if (typeof window === 'undefined') return [];
  try {
    const store = readStore();
    if (!store) return [];
    if (purgeExpiredTokens(store)) writeStore(store);

    return Object.entries(store.entries)
      .sort(([left], [right]) => {
        if (left === store.activeKey) return -1;
        if (right === store.activeKey) return 1;
        return left.localeCompare(right);
      })
      .map(([key, creds]) => ({
        id: identityId(key),
        nick: creds.nick.trim().slice(0, MAX_HANDOFF_FIELD),
        server: serverDisplayLabel(creds.server),
        savedAt: typeof creds.savedAt === 'string'
          ? creds.savedAt.slice(0, MAX_HANDOFF_FIELD)
          : '',
        active: key === store.activeKey,
        access: identityAccess(creds),
      }));
  } catch {
    return [];
  }
}

/**
 * Make a remembered identity active and return its private record to the auth
 * caller. Identity-picker rendering should use `listRememberedIdentities()`.
 */
export function selectRememberedIdentity(id: string): SavedCredentials | null {
  if (typeof window === 'undefined') return null;
  try {
    const store = readStore();
    if (!store) return null;
    if (purgeExpiredTokens(store)) writeStore(store);
    const match = Object.entries(store.entries).find(([key]) => identityId(key) === id);
    if (!match) return null;
    const [key, credentials] = match;
    store.activeKey = key;
    writeStore(store);
    localStorage.setItem('onyx:saved-nick', credentials.nick);
    return { ...credentials };
  } catch {
    return null;
  }
}

/** Forget one identity by its opaque picker id. */
export function removeRememberedIdentity(id: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const store = readStore();
    if (!store) return false;
    const match = Object.keys(store.entries).find((key) => identityId(key) === id);
    if (!match) return false;
    return removeCredentialKey(store, match);
  } catch {
    return false;
  }
}

/** Persist credentials. Pass password=undefined for guest sessions. */
export function saveCredentials(opts: {
  nick: string;
  server: string;
  password?: string;
}): void {
  if (typeof window === 'undefined') return;
  try {
    const store: CredentialsStore = readStore() ?? { version: 2, entries: {} };
    purgeExpiredTokens(store);
    const key = credentialKey(opts.server, opts.nick);
    const existing = store.entries[key];
    const preserveToken = existing
      && normalizeServer(existing.server) === normalizeServer(opts.server)
      && existing.nick.trim().toLowerCase() === opts.nick.trim().toLowerCase()
      && existing.password === opts.password;
    const creds: SavedCredentials = {
      nick:         opts.nick,
      server:       opts.server,
      password:     opts.password,
      sessionToken: preserveToken ? existing.sessionToken : undefined,
      meshToken:    preserveToken ? existing.meshToken : undefined,
      tokenExpiry:  preserveToken ? existing.tokenExpiry : undefined,
      savedAt:      new Date().toISOString(),
    };
    store.entries[key] = creds;
    store.activeKey = key;
    enforceCredentialLimit(store);
    writeStore(store);
    // Also keep legacy key so the nick field stays pre-filled
    localStorage.setItem('onyx:saved-nick', opts.nick);
  } catch { /* quota */ }
}

/**
 * Store a session token received from Orochi.
 * expiresAt is a Unix timestamp (seconds).
 * canonicalNick — if provided, overwrites the stored nick with the account
 *   name so future auto-connects use the real nick, not a '_'-suffixed alias.
 */
export function storeSessionToken(
  token: string,
  expiresAt?: number,
  canonicalNick?: string,
  target?: CredentialTokenTarget,
): void {
  if (typeof window === 'undefined') return;
  try {
    const store = readStore();
    if (!store) return; // Only store tokens when we have base credentials
    purgeExpiredTokens(store);
    const entryKey = tokenTargetKey(store, target);
    if (!entryKey) return;
    const existing = store.entries[entryKey];
    if (!existing) return;
    const expiry = expiresAt ? new Date(expiresAt * 1000).toISOString() : undefined;
    const nick = canonicalNick ?? existing.nick;
    const creds: SavedCredentials = {
      ...existing,
      nick,
      sessionToken: token,
      tokenExpiry:  expiry,
    };
    const nextKey = credentialKey(existing.server, nick);
    const wasActive = store.activeKey === entryKey;
    if (nextKey !== entryKey) delete store.entries[entryKey];
    store.entries[nextKey] = creds;
    if (wasActive || !store.activeKey) store.activeKey = nextKey;
    writeStore(store);
    // Keep legacy nick key in sync
    if (canonicalNick && store.activeKey === nextKey) {
      localStorage.setItem('onyx:saved-nick', canonicalNick);
    }
  } catch { /* quota */ }
}

/** Clear stored session token (e.g. after 401 / failed reuse). */
export function clearSessionToken(server?: string, nick?: string): void {
  if (typeof window === 'undefined') return;
  try {
    const store = readStore();
    if (!store) return;
    const key = server && nick ? credentialKey(server, nick) : store.activeKey;
    if (!key || !store.entries[key]) return;
    store.entries[key] = { ...store.entries[key], sessionToken: undefined, meshToken: undefined, tokenExpiry: undefined };
    writeStore(store);
  } catch { /* quota */ }
}

/**
 * Store a mesh-sealed reclaim token received from Orochi. Unlike the local
 * session token, this one is usable to reclaim/redirect the session from ANY
 * node in the mesh, so it survives a reconnect that lands on a different node.
 * Persisted against the active credential entry; a no-op when no base
 * credentials exist (guest sessions).
 *
 * expiresAt — a Unix timestamp (seconds). When provided, it is recorded as the
 *   local tokenExpiry so purgeExpiredTokens evicts the token on the next
 *   read/write once it lapses. When omitted (the current MTOKEN path, which
 *   carries no expiry on the wire) the token has NO local expiry and lingers in
 *   localStorage until an explicit clearSessionToken / clearCredentials — the
 *   server still enforces its own expiry on any resume attempt, so a stale local
 *   copy is a housekeeping concern, not an auth-lifetime one.
 */
export function storeMeshToken(
  token: string,
  expiresAt?: number,
  target?: CredentialTokenTarget,
): void {
  if (typeof window === 'undefined') return;
  try {
    const store = readStore();
    if (!store) return; // Only store tokens when we have base credentials
    purgeExpiredTokens(store);
    const entryKey = tokenTargetKey(store, target);
    if (!entryKey) return;
    const existing = store.entries[entryKey];
    if (!existing) return;
    // Only set tokenExpiry when the caller supplies one; otherwise preserve any
    // expiry already governing an existing token rather than clobbering it.
    store.entries[entryKey] = {
      ...existing,
      meshToken: token,
      ...(expiresAt !== undefined
        ? { tokenExpiry: new Date(expiresAt * 1000).toISOString() }
        : {}),
    };
    writeStore(store);
  } catch { /* quota */ }
}

/** Wipe all stored credentials (logout / forget me). */
export function clearCredentials(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem('onyx:saved-nick');
  } catch { /* ignore */ }
}

function removeCredentialKey(store: CredentialsStore, key: string): boolean {
  if (!store.entries[key]) return false;
  delete store.entries[key];
  const remainingKeys = Object.keys(store.entries);
  if (remainingKeys.length === 0) {
    localStorage.removeItem(KEY);
    localStorage.removeItem('onyx:saved-nick');
    return true;
  }

  if (store.activeKey === key || !store.activeKey || !store.entries[store.activeKey]) {
    store.activeKey = remainingKeys[0];
  }
  writeStore(store);
  const active = store.activeKey ? store.entries[store.activeKey] : undefined;
  if (active) localStorage.setItem('onyx:saved-nick', active.nick);
  return true;
}

/** Forget one saved identity while leaving other accounts on this device intact. */
export function removeCredentials(server: string, nick: string): void {
  if (typeof window === 'undefined') return;
  try {
    const store = readStore();
    if (!store) return;
    const key = credentialKey(server, nick);
    removeCredentialKey(store, key);
  } catch { /* quota / malformed storage */ }
}

export function exportAccountHandoffs(): AccountHandoff[] {
  if (typeof window === 'undefined') return [];
  try {
    const store = readStore();
    if (!store) return [];
    if (purgeExpiredTokens(store)) writeStore(store);
    return Object.entries(store.entries)
      .slice(0, MAX_HANDOFFS)
      .map(([key, creds]) => ({
        nick: creds.nick,
        server: creds.server,
        savedAt: creds.savedAt,
        ...(key === store.activeKey ? { active: true } : {}),
      }))
      .map(sanitizeHandoff)
      .filter((handoff): handoff is AccountHandoff => handoff !== null);
  } catch {
    return [];
  }
}

export function parseAccountHandoffs(value: unknown): AccountHandoff[] {
  if (!Array.isArray(value)) return [];
  const handoffs: AccountHandoff[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const handoff = sanitizeHandoff(item);
    if (!handoff) continue;
    const key = credentialKey(handoff.server, handoff.nick);
    if (seen.has(key)) continue;
    seen.add(key);
    handoffs.push(handoff);
    if (handoffs.length >= MAX_HANDOFFS) break;
  }
  return handoffs;
}

export function importAccountHandoffs(handoffs: readonly AccountHandoff[]): { imported: number; total: number } {
  if (typeof window === 'undefined') return { imported: 0, total: 0 };
  try {
    const store: CredentialsStore = readStore() ?? { version: 2, entries: {} };
    purgeExpiredTokens(store);
    let imported = 0;
    let preferredKey: string | undefined;
    for (const handoff of parseAccountHandoffs(handoffs)) {
      const key = credentialKey(handoff.server, handoff.nick);
      const existing = store.entries[key];
      store.entries[key] = {
        ...(existing ?? {}),
        nick: handoff.nick,
        server: handoff.server,
        savedAt: handoff.savedAt ?? existing?.savedAt ?? new Date().toISOString(),
      };
      imported += 1;
      if (handoff.active) preferredKey = key;
      if (!store.activeKey) store.activeKey = key;
    }
    if (preferredKey) store.activeKey = preferredKey;
    if (imported > 0) {
      writeStore(store);
      const active = store.activeKey ? store.entries[store.activeKey] : Object.values(store.entries)[0];
      if (active) localStorage.setItem('onyx:saved-nick', active.nick);
    }
    return { imported, total: Object.keys(store.entries).length };
  } catch {
    return { imported: 0, total: 0 };
  }
}

/**
 * Return the SASL secret (password) for a connect attempt, or undefined when
 * the identity is a guest or uses a passwordless resume path.
 *
 * The session token is intentionally NOT returned here: it is not a SASL
 * secret. It is supplied separately to IRCClient as `sessionToken` and replayed
 * via `SESSION RESUME` after IRC registration.
 */
export function getAuthSecret(creds: SavedCredentials): string | undefined {
  return creds.password;
}
