// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  COMPOSER_DRAFTS_KEY,
  MAX_COMPOSER_DRAFTS,
  MAX_DRAFT_LEN,
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

  it('truncates an over-long draft to MAX_DRAFT_LEN on set', () => {
    const long = 'a'.repeat(MAX_DRAFT_LEN + 500);
    const next = setComposerDraft({}, '#root', long);
    expect(next['#root']).toHaveLength(MAX_DRAFT_LEN);
    expect(getComposerDraft(next, '#root')).toBe('a'.repeat(MAX_DRAFT_LEN));
  });

  it('truncates an over-long draft to MAX_DRAFT_LEN on load', () => {
    const storage = makeStorage();
    const long = 'b'.repeat(MAX_DRAFT_LEN + 42);
    storage.setItem(COMPOSER_DRAFTS_KEY, JSON.stringify({ '#root': long }));
    expect(loadComposerDrafts(storage)['#root']).toHaveLength(MAX_DRAFT_LEN);
  });

  it('caps stored drafts at MAX_COMPOSER_DRAFTS keeping the first N by insertion order', () => {
    const oversized: Record<string, string> = {};
    for (let i = 0; i < MAX_COMPOSER_DRAFTS + 10; i += 1) {
      oversized[`#chan${i}`] = `draft ${i}`;
    }

    const loaded = loadComposerDrafts(
      (() => {
        const storage = makeStorage();
        storage.setItem(COMPOSER_DRAFTS_KEY, JSON.stringify(oversized));
        return storage;
      })(),
    );
    expect(Object.keys(loaded)).toHaveLength(MAX_COMPOSER_DRAFTS);
    expect(loaded['#chan0']).toBe('draft 0');
    expect(loaded[`#chan${MAX_COMPOSER_DRAFTS - 1}`]).toBe(`draft ${MAX_COMPOSER_DRAFTS - 1}`);
    expect(loaded['#chan' + MAX_COMPOSER_DRAFTS]).toBeUndefined();
  });

  it('does not persist a new target once the count cap is reached, but still updates existing ones', () => {
    let drafts: Record<string, string> = {};
    for (let i = 0; i < MAX_COMPOSER_DRAFTS; i += 1) {
      drafts = setComposerDraft(drafts, `#chan${i}`, `draft ${i}`);
    }
    expect(Object.keys(drafts)).toHaveLength(MAX_COMPOSER_DRAFTS);

    const overflow = setComposerDraft(drafts, '#overflow', 'nope');
    expect(overflow['#overflow']).toBeUndefined();
    expect(Object.keys(overflow)).toHaveLength(MAX_COMPOSER_DRAFTS);

    const updated = setComposerDraft(drafts, '#chan0', 'edited');
    expect(updated['#chan0']).toBe('edited');
    expect(Object.keys(updated)).toHaveLength(MAX_COMPOSER_DRAFTS);
  });
});
