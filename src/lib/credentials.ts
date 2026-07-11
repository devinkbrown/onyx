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
 * Session tokens are issued by Orochi after successful SASL auth via:
 *   NOTE SESSION TOKEN :<token>
 * Saved tokens are reused with SESSION RESUME after SASL succeeds. They are
 * not SASL mechanisms and must not replace the account password.
 *
 * On mesh deployments Orochi additionally emits:
 *   NOTE SESSION MTOKEN :<token>
 * a mesh-sealed reclaim token usable to resume the session from ANY node in the
 * mesh (server.zig handleSession TOKEN). It is longer than the 32-hex local
 * token; `SESSION RESUME <mtoken>` routes through handleMeshReclaim, which either
 * reclaims a detached session held locally or redirects to the owning node.
 *
 * When no token is present (first login or expired) the password is used
 * for SASL PLAIN / SCRAM.  The password is stored in plain text — same as
 * every desktop IRC client config file.
 */

const KEY = 'onyx:credentials';

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

export interface AccountHandoff {
  nick: string;
  server: string;
  savedAt?: string;
  active?: boolean;
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
  if (!raw) return null;

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
    if ((creds.sessionToken || creds.meshToken) && creds.tokenExpiry && Date.now() > new Date(creds.tokenExpiry).getTime()) {
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

/** Load credentials from localStorage. Returns null when nothing is saved. */
export function loadCredentials(server?: string, nick?: string): SavedCredentials | null {
  if (typeof window === 'undefined') return null;
  try {
    const store = readStore();
    if (!store) return null;
    if (purgeExpiredTokens(store)) writeStore(store);

    const key = server && nick ? credentialKey(server, nick) : store.activeKey;
    const creds = key ? store.entries[key] : Object.values(store.entries)[0];
    return creds ?? null;
  } catch {
    return null;
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
export function storeSessionToken(token: string, expiresAt?: number, canonicalNick?: string): void {
  if (typeof window === 'undefined') return;
  try {
    const store = readStore();
    if (!store) return; // Only store tokens when we have base credentials
    purgeExpiredTokens(store);
    const activeKey = store.activeKey ?? Object.keys(store.entries)[0];
    if (!activeKey) return;
    const existing = store.entries[activeKey];
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
    if (nextKey !== activeKey) delete store.entries[activeKey];
    store.entries[nextKey] = creds;
    store.activeKey = nextKey;
    writeStore(store);
    // Keep legacy nick key in sync
    if (canonicalNick) localStorage.setItem('onyx:saved-nick', canonicalNick);
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
 * Store a mesh-sealed reclaim token received from Orochi via
 * `NOTE SESSION MTOKEN`. Unlike the local session token, this one is usable to
 * reclaim/redirect the session from ANY node in the mesh, so it survives a
 * reconnect that lands on a different node. Persisted against the active
 * credential entry; a no-op when no base credentials exist (guest sessions).
 */
export function storeMeshToken(token: string): void {
  if (typeof window === 'undefined') return;
  try {
    const store = readStore();
    if (!store) return; // Only store tokens when we have base credentials
    purgeExpiredTokens(store);
    const activeKey = store.activeKey ?? Object.keys(store.entries)[0];
    if (!activeKey) return;
    const existing = store.entries[activeKey];
    if (!existing) return;
    store.entries[activeKey] = { ...existing, meshToken: token };
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
 * Return the SASL secret (password) for a connect attempt, or undefined for a
 * guest/token-only session.
 *
 * The session token is intentionally NOT returned here: it is not a SASL
 * secret. It is supplied separately to IRCClient as `sessionToken` and replayed
 * via `SESSION RESUME` only after SASL has already succeeded (Orochi's SESSION
 * command requires a registered, logged-in connection).
 */
export function getAuthSecret(creds: SavedCredentials): string | undefined {
  return creds.password;
}
