import { describe, expect, it } from 'vitest';

import {
  COMPOSER_DRAFTS_KEY,
  composerDraftKey,
  getComposerDraft,
  loadComposerDrafts,
  saveComposerDrafts,
  setComposerDraft,
} from './drafts';

function makeStorage(): Storage {
  const values: Record<string, string> = {};
  return {
    get length() { return Object.keys(values).length; },
    key(index: number) { return Object.keys(values)[index] ?? null; },
    getItem(key: string) { return values[key] ?? null; },
    setItem(key: string, value: string) { values[key] = value; },
    removeItem(key: string) { delete values[key]; },
    clear() { for (const key of Object.keys(values)) delete values[key]; },
  } as Storage;
}

describe('composer draft logic', () => {
  it('normalizes targets for channel and dm drafts', () => {
    expect(composerDraftKey(' #Root ')).toBe('#root');
    expect(composerDraftKey('Alice')).toBe('alice');
  });

  it('sets, reads, and removes target-scoped drafts immutably', () => {
    const withDraft = setComposerDraft({}, '#Root', 'hello');
    expect(withDraft).toEqual({ '#root': 'hello' });
    expect(getComposerDraft(withDraft, '#root')).toBe('hello');

    const cleared = setComposerDraft(withDraft, '#ROOT', '');
    expect(cleared).toEqual({});
    expect(withDraft).toEqual({ '#root': 'hello' });
  });

  it('persists sanitized drafts to storage', () => {
    const storage = makeStorage();
    saveComposerDrafts({ '#Root': 'one', empty: '', alice: 'two' }, storage);

    expect(JSON.parse(storage.getItem(COMPOSER_DRAFTS_KEY) ?? '{}')).toEqual({
      '#root': 'one',
      alice: 'two',
    });
    expect(loadComposerDrafts(storage)).toEqual({ '#root': 'one', alice: 'two' });
  });

  it('removes the storage key when all drafts are empty', () => {
    const storage = makeStorage();
    storage.setItem(COMPOSER_DRAFTS_KEY, '{"#root":"old"}');
    saveComposerDrafts({}, storage);
    expect(storage.getItem(COMPOSER_DRAFTS_KEY)).toBeNull();
  });
});
