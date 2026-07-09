import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearClientExtensionAudit,
  clearClientExtensionActions,
  exportClientExtensionActionManifest,
  normalizeClientExtensionAction,
  parseClientExtensionActionManifest,
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

  it('imports, exports, and clears reviewed extension action manifests', () => {
    const imported = parseClientExtensionActionManifest(JSON.stringify({
      version: 1,
      actions: [
        { id: 'open.status', title: 'Open status', capability: 'open-url', url: '/status/', keywords: ['status'] },
        { id: 'copy.room', title: 'Copy room', capability: 'copy-text', text: '#root' },
        { id: 'bad', title: 'Run script', capability: 'open-url', url: 'javascript:alert(1)' },
      ],
    }));

    expect(imported).toHaveLength(2);
    expect(readClientExtensionActions().map((action) => action.id)).toEqual(['open.status', 'copy.room']);
    expect(exportClientExtensionActionManifest()).toContain('"actions"');

    clearClientExtensionActions();
    expect(readClientExtensionActions()).toEqual([]);
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
