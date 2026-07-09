import { beforeEach, describe, expect, it } from 'vitest';
import {
  normalizeClientExtensionAction,
  readClientExtensionActions,
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
});
