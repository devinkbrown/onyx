// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearCredentials,
  clearSessionToken,
  exportAccountHandoffs,
  getAuthSecret,
  importAccountHandoffs,
  listRememberedIdentities,
  loadCredentials,
  MAX_CREDENTIAL_RESUME_TOKEN_LENGTH,
  MAX_CREDENTIALS_STORAGE_CHARS,
  parseAccountHandoffs,
  removeCredentials,
  removeRememberedIdentity,
  saveCredentials,
  selectRememberedIdentity,
  storeMeshToken,
  storeSessionToken,
  type AccountHandoff,
  type SavedCredentials,
} from './credentials';

const CREDENTIALS_KEY = 'onyx:credentials';
const SAVED_NICK_KEY = 'onyx:saved-nick';
const NOW = new Date('2026-07-10T12:00:00.000Z');

interface StoredCredentials {
  version: 2;
  activeKey?: string;
  entries: Record<string, SavedCredentials>;
}

function readStoredCredentials(): StoredCredentials {
  const raw = localStorage.getItem(CREDENTIALS_KEY);
  expect(raw).not.toBeNull();
  return JSON.parse(raw!) as StoredCredentials;
}

function writeStoredCredentials(store: StoredCredentials): void {
  localStorage.setItem(CREDENTIALS_KEY, JSON.stringify(store));
}

function entryKeys(): string[] {
  return Object.keys(readStoredCredentials().entries);
}

describe('credentials persistence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('returns null and no-ops when no credential store exists', () => {
    const missing = loadCredentials();

    storeSessionToken('session-token');
    storeMeshToken('mesh-token');
    clearSessionToken();

    expect(missing).toBeNull();
    expect(localStorage.getItem(CREDENTIALS_KEY)).toBeNull();
  });

  it('saves credentials under a normalized server and nick key', () => {
    saveCredentials({
      nick: '  Alice  ',
      server: 'HTTPS://Chat.Example:6697/',
      password: 'secret',
    });

    const stored = readStoredCredentials();

    expect(stored.activeKey).toBe('https://chat.example:6697|alice');
    expect(stored.entries['https://chat.example:6697|alice']).toMatchObject({
      nick: 'Alice',
      server: 'HTTPS://Chat.Example:6697/',
      password: 'secret',
      savedAt: NOW.toISOString(),
    });
    expect(localStorage.getItem(SAVED_NICK_KEY)).toBe('Alice');
    expect(loadCredentials('https://chat.example:6697', 'ALICE')).toMatchObject({
      nick: 'Alice',
      password: 'secret',
    });
  });

  it('loads a legacy single credential object', () => {
    const legacy: SavedCredentials = {
      nick: 'Alice',
      server: 'irc.example/',
      password: 'pw',
      savedAt: '2026-07-09T00:00:00.000Z',
    };
    localStorage.setItem(CREDENTIALS_KEY, JSON.stringify(legacy));

    expect(loadCredentials('IRC.EXAMPLE', 'alice')).toEqual(legacy);
    expect(exportAccountHandoffs()).toEqual([
      {
        nick: 'Alice',
        server: 'irc.example/',
        savedAt: '2026-07-09T00:00:00.000Z',
        active: true,
      },
    ]);
  });

  it('fails closed for malformed or invalid stored data', () => {
    localStorage.setItem(CREDENTIALS_KEY, '{bad json');
    expect(loadCredentials()).toBeNull();
    expect(exportAccountHandoffs()).toEqual([]);

    localStorage.setItem(CREDENTIALS_KEY, JSON.stringify({
      version: 2,
      activeKey: 'bad',
      entries: {
        bad: { nick: '', server: 'irc.example', savedAt: NOW.toISOString() },
        valid: { nick: 'Valid', server: 'irc.example', savedAt: NOW.toISOString() },
      },
    }));

    expect(loadCredentials()).toBeNull();
  });

  it('rejects prototype-backed and non-own active credential records', () => {
    localStorage.setItem(
      CREDENTIALS_KEY,
      '{"version":2,"activeKey":"__proto__","entries":{"__proto__":{"nick":"Mallory","server":"wss://evil.example","meshToken":"attacker-token","savedAt":"2026-07-10T12:00:00.000Z"}}}',
    );

    expect(loadCredentials()).toBeNull();
    expect(listRememberedIdentities()).toEqual([]);
    expect(selectRememberedIdentity('saved-attacker')).toBeNull();
    expect(Object.prototype).not.toHaveProperty('nick');

    localStorage.setItem(
      CREDENTIALS_KEY,
      '{"version":2,"activeKey":"toString","entries":{}}',
    );

    expect(loadCredentials()).toBeNull();
    expect(listRememberedIdentities()).toEqual([]);
    expect(selectRememberedIdentity('saved-attacker')).toBeNull();
  });

  it('sanitizes every optional credential field loaded from raw JSON', () => {
    localStorage.setItem(CREDENTIALS_KEY, JSON.stringify({
      version: 2,
      activeKey: 'wss://irc.example|alice',
      entries: {
        'wss://irc.example|alice': {
          nick: ' Alice ',
          server: ' wss://irc.example ',
          password: { secret: 'must-not-load' },
          sessionToken: 'contains whitespace',
          meshToken: `mesh\ncredential`,
          tokenExpiry: NOW.toISOString(),
          savedAt: ['not', 'a', 'timestamp'],
          unknownSecret: 'must-not-load',
        },
      },
    }));

    expect(loadCredentials()).toEqual({
      nick: 'Alice',
      server: 'wss://irc.example',
      savedAt: '',
    });
    const identities = listRememberedIdentities();
    expect(identities).toMatchObject([{
      nick: 'Alice',
      server: 'wss://irc.example',
      access: 'identity-only',
    }]);
    expect(selectRememberedIdentity(identities[0]!.id)).toEqual({
      nick: 'Alice',
      server: 'wss://irc.example',
      savedAt: '',
    });
  });

  it('rejects oversized credential storage before parsing', () => {
    localStorage.setItem(CREDENTIALS_KEY, `{${'x'.repeat(MAX_CREDENTIALS_STORAGE_CHARS)}}`);
    const parse = vi.spyOn(JSON, 'parse');

    expect(loadCredentials()).toBeNull();
    expect(listRememberedIdentities()).toEqual([]);
    expect(parse).not.toHaveBeenCalled();
  });

  it('preserves a live session token when the same credentials are saved again', () => {
    saveCredentials({ nick: 'Alice', server: 'irc.example', password: 'pw' });
    storeSessionToken('session-token', 1_800_000_000);
    storeMeshToken('mesh-token', 1_800_000_000);

    saveCredentials({ nick: 'alice', server: 'IRC.EXAMPLE/', password: 'pw' });

    expect(loadCredentials()).toMatchObject({
      nick: 'alice',
      server: 'IRC.EXAMPLE/',
      password: 'pw',
      sessionToken: 'session-token',
      meshToken: 'mesh-token',
      meshTokenExpiry: '2027-01-15T08:00:00.000Z',
    });
  });

  it('drops saved tokens when the saved password changes', () => {
    saveCredentials({ nick: 'Alice', server: 'irc.example', password: 'old' });
    storeSessionToken('session-token', 1_800_000_000);
    storeMeshToken('mesh-token');

    saveCredentials({ nick: 'Alice', server: 'irc.example', password: 'new' });

    const credentials = loadCredentials();
    expect(credentials).toMatchObject({ password: 'new' });
    expect(credentials?.sessionToken).toBeUndefined();
    expect(credentials?.meshToken).toBeUndefined();
    expect(credentials?.meshTokenExpiry).toBeUndefined();
  });

  it('stores a session token on the active credentials and rekeys canonical nick changes', () => {
    saveCredentials({ nick: 'Alice_', server: 'irc.example', password: 'pw' });

    storeSessionToken('session-token', 1_800_000_000, 'Alice');

    const stored = readStoredCredentials();
    expect(stored.activeKey).toBe('irc.example|alice');
    expect(entryKeys()).toEqual(['irc.example|alice']);
    expect(stored.entries['irc.example|alice']).toMatchObject({
      nick: 'Alice',
      sessionToken: 'session-token',
    });
    expect(localStorage.getItem(SAVED_NICK_KEY)).toBe('Alice');
  });

  it('stores a mesh token on the active credentials and rekeys canonical nick changes', () => {
    saveCredentials({ nick: 'Alice_', server: 'irc.example', password: 'pw' });

    storeMeshToken('mesh-token', 1_800_000_000, undefined, 'Alice');

    const stored = readStoredCredentials();
    expect(stored.activeKey).toBe('irc.example|alice');
    expect(entryKeys()).toEqual(['irc.example|alice']);
    expect(stored.entries['irc.example|alice']).toMatchObject({
      nick: 'Alice',
      meshToken: 'mesh-token',
      meshTokenExpiry: '2027-01-15T08:00:00.000Z',
    });
    expect(localStorage.getItem(SAVED_NICK_KEY)).toBe('Alice');
  });

  it('rotates into an existing canonical identity without overwriting either credential', () => {
    saveCredentials({ nick: 'Alice', server: 'irc.example', password: 'canonical-pw' });
    saveCredentials({ nick: 'Alice_', server: 'irc.example', password: 'alias-pw' });
    const aliasTarget = { server: 'irc.example', nick: 'Alice_' };

    storeMeshToken('mesh-token', 1_800_000_000, aliasTarget, 'Alice');
    storeSessionToken('session-token', undefined, 'Alice', aliasTarget);

    expect(loadCredentials('irc.example', 'Alice')).toMatchObject({
      nick: 'Alice',
      password: 'canonical-pw',
      sessionToken: 'session-token',
      meshToken: 'mesh-token',
      meshTokenExpiry: '2027-01-15T08:00:00.000Z',
    });
    expect(loadCredentials('irc.example', 'Alice_')).toMatchObject({
      nick: 'Alice_',
      password: 'alias-pw',
    });
    expect(loadCredentials()).toMatchObject({ nick: 'Alice' });
  });

  it('rotates local and mesh tokens only for an explicitly targeted identity', () => {
    saveCredentials({ nick: 'Alice', server: 'wss://alice.example', password: 'alice-pw' });
    saveCredentials({ nick: 'Bob', server: 'wss://bob.example', password: 'bob-pw' });

    storeSessionToken('alice-session', 1_800_000_000, undefined, {
      server: 'wss://alice.example',
      nick: 'Alice',
    });
    storeMeshToken('alice-mesh', undefined, {
      server: 'wss://alice.example',
      nick: 'Alice',
    });

    expect(loadCredentials('wss://alice.example', 'Alice')).toMatchObject({
      sessionToken: 'alice-session',
      meshToken: 'alice-mesh',
    });
    const bob = loadCredentials('wss://bob.example', 'Bob');
    expect(bob).toMatchObject({ password: 'bob-pw' });
    expect(bob?.sessionToken).toBeUndefined();
    expect(bob?.meshToken).toBeUndefined();
    expect(loadCredentials()).toMatchObject({ nick: 'Bob' });
  });

  it('does not fall back to the active identity when an explicit token target is missing', () => {
    saveCredentials({ nick: 'Bob', server: 'wss://bob.example', password: 'bob-pw' });

    storeSessionToken('wrong-session', undefined, undefined, {
      server: 'wss://missing.example',
      nick: 'Missing',
    });
    storeMeshToken('wrong-mesh', undefined, {
      server: 'wss://missing.example',
      nick: 'Missing',
    });

    const bob = loadCredentials('wss://bob.example', 'Bob');
    expect(bob).toMatchObject({ password: 'bob-pw' });
    expect(bob?.sessionToken).toBeUndefined();
    expect(bob?.meshToken).toBeUndefined();
  });

  it('refuses malformed, oversized, or invalid-expiry token rotations', () => {
    saveCredentials({ nick: 'Alice', server: 'wss://irc.example', password: 'pw' });
    storeSessionToken('valid-session');
    storeMeshToken('valid-mesh');

    storeSessionToken('invalid session');
    storeSessionToken('x'.repeat(MAX_CREDENTIAL_RESUME_TOKEN_LENGTH + 1));
    storeSessionToken('replacement', Number.NaN);
    storeMeshToken('invalid\nmesh');
    storeMeshToken('y'.repeat(MAX_CREDENTIAL_RESUME_TOKEN_LENGTH + 1));
    storeMeshToken('replacement', Number.POSITIVE_INFINITY);

    expect(loadCredentials()).toMatchObject({
      sessionToken: 'valid-session',
      meshToken: 'valid-mesh',
    });
  });

  it('clears local and mesh session tokens for a selected account', () => {
    saveCredentials({ nick: 'Alice', server: 'irc.example', password: 'pw' });
    storeSessionToken('session-token', 1_800_000_000);
    storeMeshToken('mesh-token');

    clearSessionToken('IRC.EXAMPLE/', 'alice');

    const credentials = loadCredentials();
    expect(credentials).toMatchObject({ password: 'pw' });
    expect(credentials?.sessionToken).toBeUndefined();
    expect(credentials?.meshToken).toBeUndefined();
    expect(credentials?.meshTokenExpiry).toBeUndefined();
  });

  it('purges expired tokens on read without deleting the base credentials', () => {
    writeStoredCredentials({
      version: 2,
      activeKey: 'irc.example|alice',
      entries: {
        'irc.example|alice': {
          nick: 'Alice',
          server: 'irc.example',
          password: 'pw',
          sessionToken: 'expired-session',
          meshToken: 'expired-mesh',
          tokenExpiry: '2026-07-10T11:59:59.000Z',
          savedAt: '2026-07-09T00:00:00.000Z',
        },
      },
    });

    const credentials = loadCredentials();
    expect(credentials).toMatchObject({ nick: 'Alice', password: 'pw' });
    // The legacy v2 expiry governed the portable bearer. Migration must keep
    // the still-valid node-local fallback while expiring only MTOKEN.
    expect(credentials?.sessionToken).toBe('expired-session');
    expect(credentials?.meshToken).toBeUndefined();
    expect(credentials?.meshTokenExpiry).toBeUndefined();

    const stored = readStoredCredentials().entries['irc.example|alice'];
    expect(stored).toMatchObject({ nick: 'Alice', password: 'pw' });
    expect(stored?.sessionToken).toBe('expired-session');
    expect(stored?.meshToken).toBeUndefined();
    expect(stored?.meshTokenExpiry).toBeUndefined();
  });

  it('fails closed for a token with an invalid expiry', () => {
    writeStoredCredentials({
      version: 2,
      activeKey: 'irc.example|alice',
      entries: {
        'irc.example|alice': {
          nick: 'Alice',
          server: 'irc.example',
          password: 'pw',
          meshToken: 'must-not-resume',
          tokenExpiry: 'not-a-date',
          savedAt: NOW.toISOString(),
        },
      },
    });

    expect(listRememberedIdentities()).toMatchObject([
      { nick: 'Alice', access: 'sign-in' },
    ]);
    expect(loadCredentials()?.meshToken).toBeUndefined();
  });

  it('records a meshTokenExpiry and purges only the portable token', () => {
    saveCredentials({ nick: 'Alice', server: 'irc.example', password: 'pw' });
    storeSessionToken('session-token');
    // 1_800_000_000s = 2027-01-15T08:00:00Z — well after the frozen NOW.
    storeMeshToken('mesh-token', 1_800_000_000);

    expect(loadCredentials()).toMatchObject({
      meshToken: 'mesh-token',
      meshTokenExpiry: '2027-01-15T08:00:00.000Z',
    });

    // Jump past the recorded expiry — the mesh token is evicted on read.
    vi.setSystemTime(new Date('2027-02-01T00:00:00.000Z'));
    const purged = loadCredentials();
    expect(purged).toMatchObject({ nick: 'Alice', password: 'pw' });
    expect(purged?.sessionToken).toBe('session-token');
    expect(purged?.meshToken).toBeUndefined();
    expect(purged?.meshTokenExpiry).toBeUndefined();
  });

  it('leaves an existing mesh expiry untouched when a mesh token is stored without one', () => {
    saveCredentials({ nick: 'Alice', server: 'irc.example', password: 'pw' });
    storeSessionToken('session-token');
    storeMeshToken('mesh-token', 1_800_000_000);
    // A legacy/no-expiry rotation must not clobber the existing mesh deadline.
    storeMeshToken('mesh-token');

    expect(loadCredentials()).toMatchObject({
      sessionToken: 'session-token',
      meshToken: 'mesh-token',
      meshTokenExpiry: '2027-01-15T08:00:00.000Z',
    });
  });

  it('does not carry an old mesh expiry onto a different legacy token', () => {
    saveCredentials({ nick: 'Alice', server: 'irc.example', password: 'pw' });
    storeMeshToken('old-mesh-token', 1_800_000_000);

    storeMeshToken('rotated-without-expiry');

    expect(loadCredentials()).toMatchObject({
      meshToken: 'rotated-without-expiry',
    });
    expect(loadCredentials()?.meshTokenExpiry).toBeUndefined();
  });

  it('parses handoffs by trimming, truncating, deduplicating, and capping entries', () => {
    const oversized = 'x'.repeat(300);
    const handoffs = parseAccountHandoffs([
      null,
      { nick: ' Alice ', server: ' IRC.EXAMPLE/ ', savedAt: oversized, active: true },
      { nick: 'alice', server: 'irc.example', active: true },
      { nick: '', server: 'irc.example' },
      ...Array.from({ length: 20 }, (_, index) => ({
        nick: `User${index}`,
        server: `irc${index}.example`,
        active: index === 0 ? false : 'yes',
      })),
    ]);

    expect(handoffs).toHaveLength(12);
    expect(handoffs[0]).toEqual({
      nick: 'Alice',
      server: 'IRC.EXAMPLE/',
      savedAt: 'x'.repeat(256),
      active: true,
    });
    expect(handoffs.some((handoff) => handoff.nick === 'alice')).toBe(false);
    expect(handoffs.slice(1).every((handoff) => handoff.active === undefined)).toBe(true);
  });

  it('imports handoffs, preserves existing secrets, and prefers the active handoff', () => {
    saveCredentials({ nick: 'Alice', server: 'irc.example', password: 'pw' });
    storeSessionToken('session-token', 1_800_000_000);

    const result = importAccountHandoffs([
      { nick: 'Bob', server: 'irc2.example', savedAt: '2026-07-08T00:00:00.000Z', active: true },
      { nick: 'Alice', server: 'irc.example', savedAt: 'ignored' },
    ]);

    const stored = readStoredCredentials();

    expect(result).toEqual({ imported: 2, total: 2 });
    expect(stored.activeKey).toBe('irc2.example|bob');
    expect(stored.entries['irc.example|alice']).toMatchObject({
      nick: 'Alice',
      password: 'pw',
      sessionToken: 'session-token',
    });
    expect(stored.entries['irc2.example|bob']).toMatchObject({
      nick: 'Bob',
      server: 'irc2.example',
      savedAt: '2026-07-08T00:00:00.000Z',
    });
    expect(localStorage.getItem(SAVED_NICK_KEY)).toBe('Bob');
  });

  it('exports at most twelve sanitized account handoffs with the active marker', () => {
    const handoffs: AccountHandoff[] = Array.from({ length: 14 }, (_, index) => ({
      nick: `User${index}`,
      server: `irc${index}.example`,
      savedAt: `2026-07-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
      active: index === 5,
    }));

    importAccountHandoffs(handoffs);

    const exported = exportAccountHandoffs();

    expect(exported).toHaveLength(12);
    expect(exported[0]).toEqual({
      nick: 'User0',
      server: 'irc0.example',
      savedAt: '2026-07-01T00:00:00.000Z',
    });
    expect(exported[5]).toEqual({
      nick: 'User5',
      server: 'irc5.example',
      savedAt: '2026-07-06T00:00:00.000Z',
      active: true,
    });
  });

  it('lists multiple identities without exposing secrets or sensitive URL parts', () => {
    const firstKey = 'wss://alice:server-secret@chat.example/ws?token=url-secret#fragment|alice';
    writeStoredCredentials({
      version: 2,
      activeKey: firstKey,
      entries: {
        [firstKey]: {
          nick: 'Alice',
          server: 'wss://alice:server-secret@chat.example/ws?token=url-secret#fragment',
          password: 'password-secret',
          sessionToken: 'session-secret',
          savedAt: '2026-07-09T00:00:00.000Z',
        },
        'wss://second.example|bob': {
          nick: 'Bob',
          server: 'wss://second.example',
          password: 'bob-password',
          savedAt: '2026-07-08T00:00:00.000Z',
        },
        'wss://third.example|carol': {
          nick: 'Carol',
          server: 'wss://third.example',
          meshToken: 'passwordless-resume-token',
          savedAt: '2026-07-07T00:00:00.000Z',
        },
      },
    });

    const identities = listRememberedIdentities();
    const serialized = JSON.stringify(identities);

    expect(identities).toHaveLength(3);
    expect(identities[0]).toMatchObject({
      nick: 'Alice',
      server: 'wss://chat.example/ws',
      active: true,
      access: 'resume',
    });
    expect(identities.find((identity) => identity.nick === 'Bob')).toMatchObject({
      server: 'wss://second.example',
      access: 'sign-in',
    });
    expect(identities.find((identity) => identity.nick === 'Carol')).toMatchObject({
      access: 'resume',
    });
    expect(serialized).not.toContain('password-secret');
    expect(serialized).not.toContain('session-secret');
    expect(serialized).not.toContain('passwordless-resume-token');
    expect(serialized).not.toContain('server-secret');
    expect(serialized).not.toContain('url-secret');
    expect(identities.every((identity) => identity.id.startsWith('saved-'))).toBe(true);
  });

  it('bounds durable remembered identities while preserving the active entry', () => {
    for (let index = 0; index < 14; index += 1) {
      saveCredentials({
        nick: `User${index}`,
        server: `wss://node-${index}.example`,
        password: `password-${index}`,
      });
    }

    const identities = listRememberedIdentities();
    const stored = JSON.parse(localStorage.getItem(CREDENTIALS_KEY) ?? '{}') as {
      entries?: Record<string, unknown>;
    };

    expect(identities).toHaveLength(12);
    expect(identities[0]).toMatchObject({ nick: 'User13', active: true });
    expect(Object.keys(stored.entries ?? {})).toHaveLength(12);
  });

  it('selects and removes identities through opaque picker ids', () => {
    saveCredentials({ nick: 'Alice', server: 'irc.example', password: 'alice-pw' });
    saveCredentials({ nick: 'Bob', server: 'irc2.example', password: 'bob-pw' });
    const alice = listRememberedIdentities().find((identity) => identity.nick === 'Alice');
    const bob = listRememberedIdentities().find((identity) => identity.nick === 'Bob');
    expect(alice).toBeDefined();
    expect(bob).toBeDefined();

    expect(selectRememberedIdentity(alice!.id)).toMatchObject({
      nick: 'Alice',
      password: 'alice-pw',
    });
    expect(listRememberedIdentities()[0]).toMatchObject({ nick: 'Alice', active: true });
    expect(localStorage.getItem(SAVED_NICK_KEY)).toBe('Alice');

    expect(removeRememberedIdentity(alice!.id)).toBe(true);
    expect(loadCredentials('irc.example', 'Alice')).toBeNull();
    expect(listRememberedIdentities()).toMatchObject([
      { id: bob!.id, nick: 'Bob', active: true },
    ]);
    expect(removeRememberedIdentity('saved-does-not-exist')).toBe(false);
  });

  it('clears all persisted credential and legacy nick state', () => {
    saveCredentials({ nick: 'Alice', server: 'irc.example', password: 'pw' });

    clearCredentials();

    expect(localStorage.getItem(CREDENTIALS_KEY)).toBeNull();
    expect(localStorage.getItem(SAVED_NICK_KEY)).toBeNull();
    expect(loadCredentials()).toBeNull();
  });

  it('removes one account without forgetting the remaining saved identities', () => {
    saveCredentials({ nick: 'Alice', server: 'irc.example', password: 'alice-pw' });
    saveCredentials({ nick: 'Bob', server: 'irc2.example', password: 'bob-pw' });

    removeCredentials('IRC2.EXAMPLE/', 'bob');

    expect(loadCredentials('irc2.example', 'Bob')).toBeNull();
    expect(loadCredentials('irc.example', 'alice')).toMatchObject({
      nick: 'Alice',
      password: 'alice-pw',
    });
    expect(loadCredentials()).toMatchObject({ nick: 'Alice' });
    expect(localStorage.getItem(SAVED_NICK_KEY)).toBe('Alice');
  });

  it('removes the credential store and saved nick after forgetting its last account', () => {
    saveCredentials({ nick: 'Alice', server: 'irc.example', password: 'pw' });

    removeCredentials('irc.example', 'Alice');

    expect(localStorage.getItem(CREDENTIALS_KEY)).toBeNull();
    expect(localStorage.getItem(SAVED_NICK_KEY)).toBeNull();
    expect(loadCredentials()).toBeNull();
  });

  it('returns only the password as the SASL auth secret', () => {
    expect(getAuthSecret({
      nick: 'Alice',
      server: 'irc.example',
      password: 'pw',
      sessionToken: 'session-token',
      meshToken: 'mesh-token',
      savedAt: NOW.toISOString(),
    })).toBe('pw');

    expect(getAuthSecret({
      nick: 'Guest',
      server: 'irc.example',
      sessionToken: 'session-token',
      savedAt: NOW.toISOString(),
    })).toBeUndefined();
  });
});
