// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CLIENT_EXTENSION_ACTIONS_STORAGE_KEY,
  CLIENT_EXTENSION_AUDIT_STORAGE_KEY,
  CLIENT_EXTENSION_JSON_MAX_CHARS,
  clearClientExtensionAudit,
  clearClientExtensionActions,
  exportClientExtensionActionManifest,
  normalizeClientExtensionAction,
  normalizeClientExtensionActions,
  parseClientExtensionActionManifest,
  previewClientExtensionAction,
  readClientExtensionAudit,
  readClientExtensionActions,
  recordClientExtensionActionRun,
  saveClientExtensionActions,
  writeClientExtensionActionsForTests,
} from './clientActions';
import { deviceMemoryStorageKey } from '@/lib/deviceMemoryOwner';

const ALICE = { serverUrl: 'wss://irc.example/ws', identity: 'alice' } as const;
const BOB = { serverUrl: 'wss://irc.example/ws', identity: 'bob' } as const;
const GUEST = { serverUrl: 'wss://irc.example/ws', identity: 'guest-42' } as const;

describe('client extension actions', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('normalizes only capability-scoped safe actions', () => {
    expect(normalizeClientExtensionAction({
      id: 'build.open',
      title: 'Open build',
      capability: 'open-url',
      url: 'https://example.test/build',
      keywords: ['build'],
    })).toMatchObject({
      id: 'build.open',
      title: 'Open build',
      capability: 'open-url',
      url: 'https://example.test/build',
    });

    expect(normalizeClientExtensionAction({
      id: 'bad',
      title: 'Run script',
      capability: 'open-url',
      url: 'javascript:alert(1)',
    })).toBeNull();

    expect(normalizeClientExtensionAction({
      id: 'bad',
      title: 'Unknown',
      capability: 'raw-js',
    })).toBeNull();
  });

  it('reads deduped extension actions from storage', () => {
    writeClientExtensionActionsForTests([
      { id: 'copy.branch', title: 'Copy branch', capability: 'copy-text', text: 'main' },
      { id: 'copy.branch', title: 'Duplicate', capability: 'copy-text', text: 'dupe' },
    ], ALICE);

    expect(readClientExtensionActions(ALICE)).toHaveLength(1);
    expect(readClientExtensionActions(ALICE)[0]).toMatchObject({
      id: 'copy.branch',
      title: 'Copy branch',
      capability: 'copy-text',
      text: 'main',
    });
  });

  it('parses reviewed manifests without persistence, then saves and exports v1 explicitly', () => {
    const parsed = parseClientExtensionActionManifest(JSON.stringify({
      version: 1,
      actions: [
        { id: 'open.status', title: 'Open status', capability: 'open-url', url: '/status/', keywords: ['status'] },
        { id: 'copy.room', title: 'Copy room', capability: 'copy-text', text: '#root' },
        { id: 'bad', title: 'Run script', capability: 'open-url', url: 'javascript:alert(1)' },
      ],
    }));

    expect(parsed).toHaveLength(2);
    expect(readClientExtensionActions(ALICE)).toEqual([]);

    const imported = saveClientExtensionActions(parsed ?? [], ALICE);
    expect(imported).toHaveLength(2);
    expect(readClientExtensionActions(ALICE).map((action) => action.id)).toEqual(['open.status', 'copy.room']);
    expect(JSON.parse(exportClientExtensionActionManifest(ALICE))).toMatchObject({ version: 1 });

    clearClientExtensionActions(ALICE);
    expect(readClientExtensionActions(ALICE)).toEqual([]);
  });

  it('fails closed for unsupported object versions while retaining legacy-array parsing', () => {
    const action = { id: 'copy.room', title: 'Copy room', capability: 'copy-text', text: '#root' };

    expect(parseClientExtensionActionManifest('{not-json')).toBeNull();
    expect(parseClientExtensionActionManifest(JSON.stringify({ version: 2, actions: [action] }))).toBeNull();
    expect(parseClientExtensionActionManifest(JSON.stringify({ actions: [action] }))).toBeNull();
    expect(parseClientExtensionActionManifest(JSON.stringify([action]))).toEqual([
      expect.objectContaining({ id: 'copy.room', text: '#root' }),
    ]);
    expect(readClientExtensionActions(ALICE)).toEqual([]);
  });

  it('rejects oversized manifest and browser-storage JSON before normalization', () => {
    const action = { id: 'copy.room', title: 'Copy room', capability: 'copy-text', text: '#root' };
    const manifest = JSON.stringify({ version: 1, actions: [action] });
    const oversizedManifest = `${manifest}${' '.repeat(CLIENT_EXTENSION_JSON_MAX_CHARS)}`;
    expect(() => JSON.parse(oversizedManifest)).not.toThrow();
    expect(parseClientExtensionActionManifest(oversizedManifest)).toBeNull();

    const actionsKey = deviceMemoryStorageKey(CLIENT_EXTENSION_ACTIONS_STORAGE_KEY, ALICE)!;
    const auditKey = deviceMemoryStorageKey(CLIENT_EXTENSION_AUDIT_STORAGE_KEY, ALICE)!;
    localStorage.setItem(
      actionsKey,
      `${JSON.stringify([action])}${' '.repeat(CLIENT_EXTENSION_JSON_MAX_CHARS)}`,
    );
    localStorage.setItem(
      auditKey,
      `${JSON.stringify([{
        id: 'copy.room',
        title: 'Copy room',
        capability: 'copy-text',
        at: '2026-07-16T12:00:00.000Z',
        detail: 'Copied 5 characters',
      }])}${' '.repeat(CLIENT_EXTENSION_JSON_MAX_CHARS)}`,
    );

    expect(readClientExtensionActions(ALICE)).toEqual([]);
    expect(readClientExtensionAudit(ALICE)).toEqual([]);
  });

  it('produces payload-safe previews without copied plaintext, URL paths, queries, or credentials', () => {
    const actions = normalizeClientExtensionActions([
      {
        id: 'open.secret',
        title: 'Open private build',
        capability: 'open-url',
        url: 'https://user:password@example.test/private?token=url-secret',
      },
      {
        id: 'copy.secret',
        title: 'Copy deploy token',
        capability: 'copy-text',
        text: 'super-secret-token',
      },
    ]);

    const previews = actions.map(previewClientExtensionAction);
    expect(previews).toEqual([
      { title: 'Open private build', capability: 'open-url', detail: 'https://example.test' },
      { title: 'Copy deploy token', capability: 'copy-text', detail: '18 characters' },
    ]);
    expect(JSON.stringify(previews)).not.toContain('password');
    expect(JSON.stringify(previews)).not.toContain('/private');
    expect(JSON.stringify(previews)).not.toContain('url-secret');
    expect(JSON.stringify(previews)).not.toContain('super-secret-token');
  });

  it('saves only normalized manifest entries', () => {
    const saved = saveClientExtensionActions([
      { id: 'copy.branch', title: 'Copy branch', capability: 'copy-text', text: 'main' },
      { id: 'copy.branch', title: 'Duplicate', capability: 'copy-text', text: 'dupe' },
      { id: 'bad', title: 'Bad', capability: 'raw-js' },
    ], ALICE);

    expect(saved).toHaveLength(1);
    expect(readClientExtensionActions(ALICE)[0]).toMatchObject({ id: 'copy.branch', text: 'main' });
  });

  it('reports storage failure and does not claim an unverified commit', () => {
    writeClientExtensionActionsForTests([
      { id: 'copy.old', title: 'Copy old', capability: 'copy-text', text: 'old' },
    ], ALICE);
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked');
    });

    const saved = saveClientExtensionActions([
      { id: 'copy.new', title: 'Copy new', capability: 'copy-text', text: 'new' },
    ], ALICE);

    expect(saved).toBeNull();
    expect(readClientExtensionActions(ALICE).map((action) => action.id)).toEqual(['copy.old']);
  });

  it('records bounded payload-safe action audit entries', () => {
    const copy = normalizeClientExtensionAction({
      id: 'copy.secret',
      title: 'Copy deploy token',
      capability: 'copy-text',
      text: 'super-secret-token',
    });
    const open = normalizeClientExtensionAction({
      id: 'open.build',
      title: 'Open build dashboard',
      capability: 'open-url',
      url: 'https://example.test/build?token=secret',
    });
    expect(copy).not.toBeNull();
    expect(open).not.toBeNull();

    recordClientExtensionActionRun(copy!, ALICE);
    recordClientExtensionActionRun(open!, ALICE);

    expect(readClientExtensionAudit(ALICE)).toHaveLength(2);
    expect(readClientExtensionAudit(ALICE)[0]).toMatchObject({
      id: 'open.build',
      title: 'Open build dashboard',
      capability: 'open-url',
      detail: 'Opened https://example.test',
    });
    expect(JSON.stringify(readClientExtensionAudit(ALICE))).not.toContain('super-secret-token');
    expect(JSON.stringify(readClientExtensionAudit(ALICE))).not.toContain('token=secret');

    clearClientExtensionAudit(ALICE);
    expect(readClientExtensionAudit(ALICE)).toEqual([]);
  });

  it('keeps only the latest audit entries', () => {
    for (let index = 0; index < 25; index += 1) {
      recordClientExtensionActionRun({
        id: `copy.${index}`,
        title: `Copy ${index}`,
        capability: 'copy-text',
        text: `value-${index}`,
        keywords: [],
      }, ALICE);
    }

    const entries = readClientExtensionAudit(ALICE);
    expect(entries).toHaveLength(20);
    expect(entries[0]?.id).toBe('copy.24');
    expect(entries.at(-1)?.id).toBe('copy.5');
  });

  it('isolates actions by owner, supports guest scopes, and fails closed without an owner', () => {
    expect(saveClientExtensionActions([
      { id: 'alice.copy', title: 'Alice copy', capability: 'copy-text', text: 'alice' },
    ], ALICE)).toHaveLength(1);
    expect(saveClientExtensionActions([
      { id: 'bob.copy', title: 'Bob copy', capability: 'copy-text', text: 'bob' },
    ], BOB)).toHaveLength(1);
    expect(saveClientExtensionActions([
      { id: 'guest.copy', title: 'Guest copy', capability: 'copy-text', text: 'guest' },
    ], GUEST)).toHaveLength(1);

    expect(readClientExtensionActions(ALICE).map((action) => action.id)).toEqual(['alice.copy']);
    expect(readClientExtensionActions(BOB).map((action) => action.id)).toEqual(['bob.copy']);
    expect(readClientExtensionActions(GUEST).map((action) => action.id)).toEqual(['guest.copy']);
    expect(readClientExtensionActions()).toEqual([]);
    expect(saveClientExtensionActions([], undefined)).toBeNull();
    expect(JSON.parse(exportClientExtensionActionManifest())).toEqual({ version: 1, actions: [] });

    clearClientExtensionActions(BOB);
    expect(readClientExtensionActions(BOB)).toEqual([]);
    expect(readClientExtensionActions(ALICE).map((action) => action.id)).toEqual(['alice.copy']);
  });

  it('purges unsafe ownerless action and audit data without claiming it for an owner', () => {
    localStorage.setItem(CLIENT_EXTENSION_ACTIONS_STORAGE_KEY, JSON.stringify([
      { id: 'legacy.copy', title: 'Legacy copy', capability: 'copy-text', text: 'secret' },
    ]));
    localStorage.setItem(CLIENT_EXTENSION_AUDIT_STORAGE_KEY, JSON.stringify([
      {
        id: 'legacy.copy',
        title: 'Legacy copy',
        capability: 'copy-text',
        at: '2026-07-16T12:00:00.000Z',
        detail: 'Copied 6 characters',
      },
    ]));

    expect(readClientExtensionActions(ALICE)).toEqual([]);
    expect(readClientExtensionAudit(ALICE)).toEqual([]);
    expect(localStorage.getItem(CLIENT_EXTENSION_ACTIONS_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(CLIENT_EXTENSION_AUDIT_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(deviceMemoryStorageKey(CLIENT_EXTENSION_ACTIONS_STORAGE_KEY, ALICE)!)).toBeNull();
  });

  it('isolates audit history by owner and does not audit without an owner', () => {
    const action = normalizeClientExtensionAction({
      id: 'copy.branch',
      title: 'Copy branch',
      capability: 'copy-text',
      text: 'release/onyx',
    })!;

    recordClientExtensionActionRun(action, ALICE);
    recordClientExtensionActionRun({ ...action, id: 'copy.bob', title: 'Copy Bob' }, BOB);
    recordClientExtensionActionRun({ ...action, id: 'copy.unowned', title: 'Copy unowned' });

    expect(readClientExtensionAudit(ALICE).map((entry) => entry.id)).toEqual(['copy.branch']);
    expect(readClientExtensionAudit(BOB).map((entry) => entry.id)).toEqual(['copy.bob']);
    expect(readClientExtensionAudit()).toEqual([]);
  });
});
