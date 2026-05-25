import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadCredentials,
  saveCredentials,
  storeSessionToken,
  clearSessionToken,
  clearCredentials,
  getAuthSecret,
} from '@/lib/credentials';

// ─────────────────────────────────────────────────────────────────────────────
// localStorage stub (jsdom provides this, just reset between tests)
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  localStorage.clear();
});

// ─────────────────────────────────────────────────────────────────────────────
// loadCredentials
// ─────────────────────────────────────────────────────────────────────────────

describe('loadCredentials', () => {
  it('returns null when nothing stored', () => {
    expect(loadCredentials()).toBeNull();
  });

  it('returns null for corrupt JSON', () => {
    localStorage.setItem('ocean-credentials', '{broken');
    expect(loadCredentials()).toBeNull();
  });

  it('returns null when nick missing', () => {
    localStorage.setItem('ocean-credentials', JSON.stringify({ server: 'wss://x' }));
    expect(loadCredentials()).toBeNull();
  });

  it('loads valid credentials', () => {
    const data = { nick: 'devin', server: 'wss://eshmaki.me:8080', savedAt: new Date().toISOString() };
    localStorage.setItem('ocean-credentials', JSON.stringify(data));
    const creds = loadCredentials();
    expect(creds?.nick).toBe('devin');
    expect(creds?.server).toBe('wss://eshmaki.me:8080');
  });

  it('transparently purges an expired session token', () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const data = {
      nick: 'devin',
      server: 'wss://x',
      sessionToken: 'sst_abc',
      tokenExpiry: past,
      savedAt: past,
    };
    localStorage.setItem('ocean-credentials', JSON.stringify(data));
    const creds = loadCredentials();
    expect(creds?.sessionToken).toBeUndefined();
    expect(creds?.tokenExpiry).toBeUndefined();
  });

  it('keeps a token that has not expired', () => {
    const future = new Date(Date.now() + 1_000_000).toISOString();
    const data = {
      nick: 'devin',
      server: 'wss://x',
      sessionToken: 'sst_alive',
      tokenExpiry: future,
      savedAt: future,
    };
    localStorage.setItem('ocean-credentials', JSON.stringify(data));
    const creds = loadCredentials();
    expect(creds?.sessionToken).toBe('sst_alive');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// saveCredentials
// ─────────────────────────────────────────────────────────────────────────────

describe('saveCredentials', () => {
  it('persists nick and server', () => {
    saveCredentials({ nick: 'alice', server: 'wss://irc.test' });
    const creds = loadCredentials();
    expect(creds?.nick).toBe('alice');
    expect(creds?.server).toBe('wss://irc.test');
  });

  it('persists password when provided', () => {
    saveCredentials({ nick: 'alice', server: 'wss://irc.test', password: 'hunter2' });
    const creds = loadCredentials();
    expect(creds?.password).toBe('hunter2');
  });

  it('preserves existing session token across save', () => {
    // Simulate: user has token from previous session
    saveCredentials({ nick: 'alice', server: 'wss://irc.test' });
    const future = new Date(Date.now() + 1_000_000).toISOString();
    localStorage.setItem('ocean-credentials', JSON.stringify({
      nick: 'alice', server: 'wss://irc.test',
      sessionToken: 'sst_existing', tokenExpiry: future,
      savedAt: future,
    }));
    // Re-save (e.g. remember me toggle)
    saveCredentials({ nick: 'alice', server: 'wss://irc.test' });
    const creds = loadCredentials();
    expect(creds?.sessionToken).toBe('sst_existing');
  });

  it('also saves ocean-saved-nick', () => {
    saveCredentials({ nick: 'bob', server: 'wss://x' });
    expect(localStorage.getItem('ocean-saved-nick')).toBe('bob');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// storeSessionToken
// ─────────────────────────────────────────────────────────────────────────────

describe('storeSessionToken', () => {
  it('does nothing when no base credentials exist', () => {
    storeSessionToken('sst_abc', Date.now() / 1000 + 3600);
    expect(loadCredentials()).toBeNull();
  });

  it('stores token and expiry when base credentials exist', () => {
    saveCredentials({ nick: 'devin', server: 'wss://eshmaki.me:8080' });
    const expiresAt = Math.floor(Date.now() / 1000) + 3600 * 24;
    storeSessionToken('sst_deadbeef', expiresAt);
    const creds = loadCredentials();
    expect(creds?.sessionToken).toBe('sst_deadbeef');
    expect(creds?.tokenExpiry).toBeDefined();
  });

  it('token is returned as auth secret', () => {
    saveCredentials({ nick: 'devin', server: 'wss://x', password: 'pw' });
    const expiry = Math.floor(Date.now() / 1000) + 3600;
    storeSessionToken('sst_token', expiry);
    const creds = loadCredentials()!;
    expect(getAuthSecret(creds)).toBe('sst_token');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// clearSessionToken
// ─────────────────────────────────────────────────────────────────────────────

describe('clearSessionToken', () => {
  it('removes token while preserving other fields', () => {
    saveCredentials({ nick: 'devin', server: 'wss://x', password: 'pw' });
    const expiry = Math.floor(Date.now() / 1000) + 3600;
    storeSessionToken('sst_tbd', expiry);
    clearSessionToken();
    const creds = loadCredentials();
    expect(creds?.sessionToken).toBeUndefined();
    expect(creds?.password).toBe('pw');
    expect(creds?.nick).toBe('devin');
  });

  it('is a no-op when nothing stored', () => {
    expect(() => clearSessionToken()).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// clearCredentials
// ─────────────────────────────────────────────────────────────────────────────

describe('clearCredentials', () => {
  it('removes all credentials', () => {
    saveCredentials({ nick: 'devin', server: 'wss://x' });
    clearCredentials();
    expect(loadCredentials()).toBeNull();
    expect(localStorage.getItem('ocean-saved-nick')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getAuthSecret
// ─────────────────────────────────────────────────────────────────────────────

describe('getAuthSecret', () => {
  it('prefers token over password', () => {
    const creds = {
      nick: 'x', server: 'wss://x', password: 'pass',
      sessionToken: 'sst_token',
      savedAt: new Date().toISOString(),
    };
    expect(getAuthSecret(creds)).toBe('sst_token');
  });

  it('falls back to password when no token', () => {
    const creds = {
      nick: 'x', server: 'wss://x', password: 'mypass',
      savedAt: new Date().toISOString(),
    };
    expect(getAuthSecret(creds)).toBe('mypass');
  });

  it('returns undefined when neither present', () => {
    const creds = { nick: 'x', server: 'wss://x', savedAt: new Date().toISOString() };
    expect(getAuthSecret(creds)).toBeUndefined();
  });
});
