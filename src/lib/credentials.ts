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
export const MAX_CREDENTIAL_RESUME_TOKEN_LENGTH = 4 * 1024;

const MAX_CREDENTIAL_NICK_LENGTH = 64;
const MAX_CREDENTIAL_SERVER_LENGTH = 2 * 1024;
const MAX_CREDENTIAL_PASSWORD_LENGTH = 64 * 1024;
const MAX_CREDENTIAL_TIMESTAMP_LENGTH = 64;

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

function emptyCredentialEntries(): Record<string, SavedCredentials> {
  return Object.create(null) as Record<string, SavedCredentials>;
}

function ownCredential(
  store: CredentialsStore,
  key: string | undefined,
): SavedCredentials | undefined {
  return key && Object.hasOwn(store.entries, key) ? store.entries[key] : undefined;
}

function sanitizeCredentialNick(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_CREDENTIAL_NICK_LENGTH * 2) return null;
  const nick = value.trim();
  return nick.length > 0
    && nick.length <= MAX_CREDENTIAL_NICK_LENGTH
    && /^[A-Za-z[\]\\`_^{|}][A-Za-z0-9[\]\\`_^{|}-]*$/u.test(nick)
    ? nick
    : null;
}

function sanitizeCredentialServer(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_CREDENTIAL_SERVER_LENGTH * 2) return null;
  const server = value.trim();
  return server.length > 0
    && server.length <= MAX_CREDENTIAL_SERVER_LENGTH
    && !/[\u0000-\u0020\u007f]/u.test(server)
    ? server
    : null;
}

function sanitizeCredentialPassword(value: unknown): string | undefined {
  return typeof value === 'string'
    && value.length <= MAX_CREDENTIAL_PASSWORD_LENGTH
    && !/[\u0000-\u001f\u007f]/u.test(value)
    ? value
    : undefined;
}

function sanitizeResumeToken(value: unknown): string | undefined {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_CREDENTIAL_RESUME_TOKEN_LENGTH
    && !/[\s\u0000-\u001f\u007f]/u.test(value)
    ? value
    : undefined;
}

function sanitizeTimestamp(value: unknown): string | undefined {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > MAX_CREDENTIAL_TIMESTAMP_LENGTH
  ) return undefined;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return undefined;
  try {
    return new Date(milliseconds).toISOString();
  } catch {
    return undefined;
  }
}

function sanitizeSavedCredentials(value: unknown): SavedCredentials | null {
  if (!isRecord(value)) return null;
  const nick = sanitizeCredentialNick(value.nick);
  const server = sanitizeCredentialServer(value.server);
  if (!nick || !server) return null;

  const password = sanitizeCredentialPassword(value.password);
  const sessionToken = sanitizeResumeToken(value.sessionToken);
  const meshToken = sanitizeResumeToken(value.meshToken);
  const hasPersistedExpiry = Object.hasOwn(value, 'tokenExpiry');
  const tokenExpiry = sanitizeTimestamp(value.tokenExpiry);
  const acceptTokens = !hasPersistedExpiry || tokenExpiry !== undefined;

  return {
    nick,
    server,
    ...(password !== undefined ? { password } : {}),
    ...(acceptTokens && sessionToken !== undefined ? { sessionToken } : {}),
    ...(acceptTokens && meshToken !== undefined ? { meshToken } : {}),
    ...(acceptTokens && tokenExpiry !== undefined && (sessionToken || meshToken)
      ? { tokenExpiry }
      : {}),
    savedAt: sanitizeTimestamp(value.savedAt) ?? '',
  };
}

function expiryFromSeconds(value: number | undefined): string | undefined | null {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value <= 0) return null;
  try {
    return new Date(value * 1000).toISOString();
  } catch {
    return null;
  }
}

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
    const server = sanitizeCredentialServer(target.server);
    const nick = sanitizeCredentialNick(target.nick);
    if (!server || !nick) return undefined;
    const exact = credentialKey(server, nick);
    return ownCredential(store, exact) ? exact : undefined;
  }
  const active = store.activeKey ?? Object.keys(store.entries)[0];
  return ownCredential(store, active) ? active : undefined;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeHandoff(value: unknown): AccountHandoff | null {
  if (!isRecord(value)) return null;
  const nick = sanitizeCredentialNick(value.nick);
  const server = sanitizeCredentialServer(value.server);
  if (!nick || !server || server.length > MAX_HANDOFF_FIELD) return null;
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
  if (isRecord(parsed) && parsed.version === 2 && isRecord(parsed.entries)) {
    const entries = emptyCredentialEntries();
    for (const [key, value] of Object.entries(parsed.entries)) {
      const credentials = sanitizeSavedCredentials(value);
      if (credentials && key === credentialKey(credentials.server, credentials.nick)) {
        entries[key] = credentials;
      }
    }
    const firstKey = Object.keys(entries)[0];
    const requestedActiveKey = typeof parsed.activeKey === 'string'
      ? parsed.activeKey
      : undefined;
    return {
      version: 2,
      activeKey: ownCredential({ version: 2, entries }, requestedActiveKey)
        ? requestedActiveKey
        : firstKey,
      entries,
    };
  }

  // Legacy single-credential object.
  const legacy = sanitizeSavedCredentials(parsed);
  if (legacy) {
    const key = credentialKey(legacy.server, legacy.nick);
    const entries = emptyCredentialEntries();
    entries[key] = legacy;
    return { version: 2, activeKey: key, entries };
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
  if (!ownCredential(store, store.activeKey)) store.activeKey = keys[0];
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

    const safeServer = server === undefined ? undefined : sanitizeCredentialServer(server);
    const safeNick = nick === undefined ? undefined : sanitizeCredentialNick(nick);
    if ((server !== undefined && !safeServer) || (nick !== undefined && !safeNick)) return null;
    const key = safeServer && safeNick ? credentialKey(safeServer, safeNick) : store.activeKey;
    const creds = key ? ownCredential(store, key) : Object.values(store.entries)[0];
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
    const nick = sanitizeCredentialNick(opts.nick);
    const server = sanitizeCredentialServer(opts.server);
    const password = sanitizeCredentialPassword(opts.password);
    if (!nick || !server || (opts.password !== undefined && password === undefined)) return;
    const store: CredentialsStore = readStore() ?? { version: 2, entries: emptyCredentialEntries() };
    purgeExpiredTokens(store);
    const key = credentialKey(server, nick);
    const existing = ownCredential(store, key);
    const preserveToken = existing
      && normalizeServer(existing.server) === normalizeServer(server)
      && existing.nick.toLowerCase() === nick.toLowerCase()
      && existing.password === password;
    const creds: SavedCredentials = {
      nick,
      server,
      password,
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
    localStorage.setItem('onyx:saved-nick', nick);
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
    const safeToken = sanitizeResumeToken(token);
    const expiry = expiryFromSeconds(expiresAt);
    const safeCanonicalNick = canonicalNick === undefined
      ? undefined
      : sanitizeCredentialNick(canonicalNick);
    if (!safeToken || expiry === null || (canonicalNick !== undefined && !safeCanonicalNick)) return;
    const store = readStore();
    if (!store) return; // Only store tokens when we have base credentials
    purgeExpiredTokens(store);
    const entryKey = tokenTargetKey(store, target);
    if (!entryKey) return;
    const existing = ownCredential(store, entryKey);
    if (!existing) return;
    const nick = safeCanonicalNick ?? existing.nick;
    const creds: SavedCredentials = {
      ...existing,
      nick,
      sessionToken: safeToken,
      tokenExpiry:  expiry,
    };
    const nextKey = credentialKey(existing.server, nick);
    const wasActive = store.activeKey === entryKey;
    if (nextKey !== entryKey) delete store.entries[entryKey];
    store.entries[nextKey] = creds;
    if (wasActive || !store.activeKey) store.activeKey = nextKey;
    writeStore(store);
    // Keep legacy nick key in sync
    if (safeCanonicalNick && store.activeKey === nextKey) {
      localStorage.setItem('onyx:saved-nick', safeCanonicalNick);
    }
  } catch { /* quota */ }
}

/** Clear stored session token (e.g. after 401 / failed reuse). */
export function clearSessionToken(server?: string, nick?: string): void {
  if (typeof window === 'undefined') return;
  try {
    const store = readStore();
    if (!store) return;
    const safeServer = server === undefined ? undefined : sanitizeCredentialServer(server);
    const safeNick = nick === undefined ? undefined : sanitizeCredentialNick(nick);
    if ((server !== undefined && !safeServer) || (nick !== undefined && !safeNick)) return;
    const key = safeServer && safeNick ? credentialKey(safeServer, safeNick) : store.activeKey;
    const existing = ownCredential(store, key);
    if (!key || !existing) return;
    store.entries[key] = { ...existing, sessionToken: undefined, meshToken: undefined, tokenExpiry: undefined };
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
    const safeToken = sanitizeResumeToken(token);
    const expiry = expiryFromSeconds(expiresAt);
    if (!safeToken || expiry === null) return;
    const store = readStore();
    if (!store) return; // Only store tokens when we have base credentials
    purgeExpiredTokens(store);
    const entryKey = tokenTargetKey(store, target);
    if (!entryKey) return;
    const existing = ownCredential(store, entryKey);
    if (!existing) return;
    // Only set tokenExpiry when the caller supplies one; otherwise preserve any
    // expiry already governing an existing token rather than clobbering it.
    store.entries[entryKey] = {
      ...existing,
      meshToken: safeToken,
      ...(expiry !== undefined
        ? { tokenExpiry: expiry }
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
  if (!ownCredential(store, key)) return false;
  delete store.entries[key];
  const remainingKeys = Object.keys(store.entries);
  if (remainingKeys.length === 0) {
    localStorage.removeItem(KEY);
    localStorage.removeItem('onyx:saved-nick');
    return true;
  }

  if (store.activeKey === key || !ownCredential(store, store.activeKey)) {
    store.activeKey = remainingKeys[0];
  }
  writeStore(store);
  const active = ownCredential(store, store.activeKey);
  if (active) localStorage.setItem('onyx:saved-nick', active.nick);
  return true;
}

/** Forget one saved identity while leaving other accounts on this device intact. */
export function removeCredentials(server: string, nick: string): void {
  if (typeof window === 'undefined') return;
  try {
    const store = readStore();
    if (!store) return;
    const safeServer = sanitizeCredentialServer(server);
    const safeNick = sanitizeCredentialNick(nick);
    if (!safeServer || !safeNick) return;
    const key = credentialKey(safeServer, safeNick);
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
    const store: CredentialsStore = readStore() ?? { version: 2, entries: emptyCredentialEntries() };
    purgeExpiredTokens(store);
    let imported = 0;
    let preferredKey: string | undefined;
    for (const handoff of parseAccountHandoffs(handoffs)) {
      const key = credentialKey(handoff.server, handoff.nick);
      const existing = ownCredential(store, key);
      store.entries[key] = {
        ...(existing ?? {}),
        nick: handoff.nick,
        server: handoff.server,
        savedAt: sanitizeTimestamp(handoff.savedAt)
          ?? existing?.savedAt
          ?? new Date().toISOString(),
      };
      imported += 1;
      if (handoff.active) preferredKey = key;
      if (!store.activeKey) store.activeKey = key;
    }
    if (preferredKey) store.activeKey = preferredKey;
    if (imported > 0) {
      writeStore(store);
      const active = ownCredential(store, store.activeKey) ?? Object.values(store.entries)[0];
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
  return sanitizeCredentialPassword(creds.password);
}
