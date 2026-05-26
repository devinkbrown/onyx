/**
 * lib/credentials.ts
 * Ocean — login credential persistence
 *
 * Storage layout (localStorage key: 'ocean-credentials'):
 *   nick        — IRC nickname
 *   server      — WebSocket URL
 *   password    — NickServ/SASL password (optional; omitted for guests)
 *   sessionToken— Ophion-issued short-lived token (replaces password when present)
 *   tokenExpiry — ISO timestamp; token is cleared after this
 *   savedAt     — ISO timestamp of last save
 *
 * Session tokens are issued by Ophion after successful SASL auth via:
 *   NOTICE <nick> :SESSIONTOKEN <token> <expires_unix>
 * When a valid token is present Ocean uses AUTHENTICATE SESSION-TOKEN
 * (the IRC client detects the "sst_" prefix and selects the mechanism
 * automatically).  This way the user's actual password never needs to be
 * persisted.
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
  /** Ophion-issued short-lived session token */
  sessionToken?: string;
  /** Token validity deadline — ISO string */
  tokenExpiry?: string;
  /** When these credentials were last written */
  savedAt: string;
}

/** Load credentials from localStorage. Returns null when nothing is saved. */
export function loadCredentials(): SavedCredentials | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const creds = JSON.parse(raw) as SavedCredentials;
    if (!creds.nick || !creds.server) return null;
    // Purge expired session token transparently
    if (creds.sessionToken && creds.tokenExpiry) {
      if (Date.now() > new Date(creds.tokenExpiry).getTime()) {
        creds.sessionToken = undefined;
        creds.tokenExpiry  = undefined;
        localStorage.setItem(KEY, JSON.stringify(creds));
      }
    }
    return creds;
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
    // Preserve any existing session token
    const existing = loadCredentials();
    const creds: SavedCredentials = {
      nick:         opts.nick,
      server:       opts.server,
      password:     opts.password,
      sessionToken: existing?.sessionToken,
      tokenExpiry:  existing?.tokenExpiry,
      savedAt:      new Date().toISOString(),
    };
    localStorage.setItem(KEY, JSON.stringify(creds));
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
export function storeSessionToken(token: string, expiresAt: number, canonicalNick?: string): void {
  if (typeof window === 'undefined') return;
  try {
    const existing = loadCredentials();
    if (!existing) return; // Only store tokens when we have base credentials
    const expiry = new Date(expiresAt * 1000).toISOString();
    const creds: SavedCredentials = {
      ...existing,
      nick:        canonicalNick ?? existing.nick,
      sessionToken: token,
      tokenExpiry:  expiry,
    };
    localStorage.setItem(KEY, JSON.stringify(creds));
    // Keep legacy nick key in sync
    if (canonicalNick) localStorage.setItem('ocean-saved-nick', canonicalNick);
  } catch { /* quota */ }
}

/** Clear stored session token (e.g. after 401 / failed reuse). */
export function clearSessionToken(): void {
  if (typeof window === 'undefined') return;
  try {
    const existing = loadCredentials();
    if (!existing) return;
    const creds: SavedCredentials = { ...existing, sessionToken: undefined, tokenExpiry: undefined };
    localStorage.setItem(KEY, JSON.stringify(creds));
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
  if (creds.sessionToken) {
    // Ophion accepts the token as if it were the SASL password
    return creds.sessionToken;
  }
  return creds.password;
}
