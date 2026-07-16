// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
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
    ]);

    expect(readClientExtensionActions()).toHaveLength(1);
    expect(readClientExtensionActions()[0]).toMatchObject({
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
    expect(readClientExtensionActions()).toEqual([]);

    const imported = saveClientExtensionActions(parsed ?? []);
    expect(imported).toHaveLength(2);
    expect(readClientExtensionActions().map((action) => action.id)).toEqual(['open.status', 'copy.room']);
    expect(JSON.parse(exportClientExtensionActionManifest())).toMatchObject({ version: 1 });

    clearClientExtensionActions();
    expect(readClientExtensionActions()).toEqual([]);
  });

  it('fails closed for unsupported object versions while retaining legacy-array parsing', () => {
    const action = { id: 'copy.room', title: 'Copy room', capability: 'copy-text', text: '#root' };

    expect(parseClientExtensionActionManifest('{not-json')).toBeNull();
    expect(parseClientExtensionActionManifest(JSON.stringify({ version: 2, actions: [action] }))).toBeNull();
    expect(parseClientExtensionActionManifest(JSON.stringify({ actions: [action] }))).toBeNull();
    expect(parseClientExtensionActionManifest(JSON.stringify([action]))).toEqual([
      expect.objectContaining({ id: 'copy.room', text: '#root' }),
    ]);
    expect(readClientExtensionActions()).toEqual([]);
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
    ]);

    expect(saved).toHaveLength(1);
    expect(readClientExtensionActions()[0]).toMatchObject({ id: 'copy.branch', text: 'main' });
  });

  it('reports storage failure and does not claim an unverified commit', () => {
    writeClientExtensionActionsForTests([
      { id: 'copy.old', title: 'Copy old', capability: 'copy-text', text: 'old' },
    ]);
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked');
    });

    const saved = saveClientExtensionActions([
      { id: 'copy.new', title: 'Copy new', capability: 'copy-text', text: 'new' },
    ]);

    expect(saved).toBeNull();
    expect(readClientExtensionActions().map((action) => action.id)).toEqual(['copy.old']);
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

    recordClientExtensionActionRun(copy!);
    recordClientExtensionActionRun(open!);

    expect(readClientExtensionAudit()).toHaveLength(2);
    expect(readClientExtensionAudit()[0]).toMatchObject({
      id: 'open.build',
      title: 'Open build dashboard',
      capability: 'open-url',
      detail: 'Opened https://example.test',
    });
    expect(JSON.stringify(readClientExtensionAudit())).not.toContain('super-secret-token');
    expect(JSON.stringify(readClientExtensionAudit())).not.toContain('token=secret');

    clearClientExtensionAudit();
    expect(readClientExtensionAudit()).toEqual([]);
  });

  it('keeps only the latest audit entries', () => {
    for (let index = 0; index < 25; index += 1) {
      recordClientExtensionActionRun({
        id: `copy.${index}`,
        title: `Copy ${index}`,
        capability: 'copy-text',
        text: `value-${index}`,
        keywords: [],
      });
    }

    const entries = readClientExtensionAudit();
    expect(entries).toHaveLength(20);
    expect(entries[0]?.id).toBe('copy.24');
    expect(entries.at(-1)?.id).toBe('copy.5');
  });
});
