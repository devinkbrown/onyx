/**
 * lib/credentials.ts
 * Ocean — login credential persistence
 *
 * Storage layout (localStorage key: 'ocean-credentials'):
 *   version     — storage schema version
 *   activeKey   — last-used credential key
 *   entries     — saved credentials keyed by normalized server + nick
 *
 * Session tokens are issued by Orochi after successful SASL auth via:
 *   NOTE SESSION TOKEN :<token>
 * Saved tokens are reused with SESSION RESUME after SASL succeeds. They are
 * not SASL mechanisms and must not replace the account password.
 *
 * When no token is present (first login or expired) the password is used
 * for SASL PLAIN / SCRAM.  The password is stored in plain text — same as
 * every desktop IRC client config file.
 */

const KEY = 'ocean-credentials';

export interface SavedCredentials {
  nick: string;
  server: string;
  /** NickServ / SASL password — only set when user opted in AND no valid token */
  password?: string;
  /** Orochi-issued session resume token */
  sessionToken?: string;
  /** Token validity deadline — ISO string */
  tokenExpiry?: string;
  /** When these credentials were last written */
  savedAt: string;
}

interface CredentialsStore {
  version: 2;
  activeKey?: string;
  entries: Record<string, SavedCredentials>;
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

function isSavedCredentials(value: unknown): value is SavedCredentials {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SavedCredentials>;
  return typeof candidate.nick === 'string'
    && candidate.nick.length > 0
    && typeof candidate.server === 'string'
    && candidate.server.length > 0;
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
    if (creds.sessionToken && creds.tokenExpiry && Date.now() > new Date(creds.tokenExpiry).getTime()) {
      store.entries[key] = {
        ...creds,
        sessionToken: undefined,
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
      tokenExpiry:  preserveToken ? existing.tokenExpiry : undefined,
      savedAt:      new Date().toISOString(),
    };
    store.entries[key] = creds;
    store.activeKey = key;
    writeStore(store);
    // Also keep legacy key so the nick field stays pre-filled
    localStorage.setItem('ocean-saved-nick', opts.nick);
  } catch { /* quota */ }
}

/**
 * Store a session token received from Ophion.
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
    if (canonicalNick) localStorage.setItem('ocean-saved-nick', canonicalNick);
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
    store.entries[key] = { ...store.entries[key], sessionToken: undefined, tokenExpiry: undefined };
    writeStore(store);
  } catch { /* quota */ }
}

/** Wipe all stored credentials (logout / forget me). */
export function clearCredentials(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem('ocean-saved-nick');
  } catch { /* ignore */ }
}

/**
 * Return the best available auth secret for a connect attempt.
 * Prefers session token; falls back to password; falls back to undefined.
 */
export function getAuthSecret(creds: SavedCredentials): string | undefined {
  return creds.password;
}
